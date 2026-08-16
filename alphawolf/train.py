import math
import os
import collections
import numpy as np
import torch
import torch.nn.functional as F
import torch.optim as optim
from torch.utils.data import DataLoader

from models.net import AlphaWolfNet, grid_tensor_to_pyg_data
from envs.howl_env import HowlEnv, MAX_ROWS, MAX_COLS
from db.tablebase import query_tablebase, insert_or_update_rank4_induction, upsert_subgraph, upsert_grid_solution
from core_engine.hashing import generate_canonical_hash, generate_canonical_data
from core_engine.graph_logic import GridGraph

C_PUCT = 1.0

def clone_env_from_obs(obs, m, n, current_cuts=0):
    sim_env = HowlEnv(m, n, generate=False)
    active_coords = np.argwhere(obs[0] == 1)
    for x, y in active_coords:
        sim_env.graph._add_vertex((int(x), int(y)))
        
    for x, y in sim_env.graph.vertices:
        for dx, dy in [(0, 1), (1, 0)]:
            if (x+dx, y+dy) in sim_env.graph.vertices:
                sim_env.graph._add_edge((x, y), (x+dx, y+dy))
                
    sim_env.cuts_made = current_cuts
    return sim_env

def evaluate_fragment_rank(frag, m, n, net):
    verts = [{"x": x, "y": y} for x, y in frag.vertices]
    can_hash = generate_canonical_hash(verts)
    db_res_dict = query_tablebase([can_hash])
    db_res = db_res_dict.get(can_hash)
    
    if db_res and (db_res['is_optimal'] or db_res['best_rank'] <= 3):
        return float(db_res['best_rank'])
        
    frag_env = HowlEnv(m, n, generate=False)
    frag_env.graph = frag
    frag_obs = frag_env._get_obs()
        
    with torch.no_grad():
        state_tensor = torch.tensor(frag_obs, dtype=torch.float32).unsqueeze(0)
        state_tensor = state_tensor.to(next(net.parameters()).device)
        _, v = net(state_tensor)
        nn_val = v.item()
        
    if db_res and not db_res['is_optimal']:
        nn_val = min(nn_val, float(db_res['best_rank']))
    else:
        nn_val = max(nn_val, 4.0)
        
    return nn_val

class MCTSNode:
    def __init__(self, state, parent=None, prior=0.0):
        self.state = state
        self.parent = parent
        self.children = {}
        self.visit_count = 0
        self.value_sum = 0.0
        self.prior = prior
        self.is_terminal = False
        self.terminal_rank = None
        self.is_expanded = False
        # In-flight simulations traversing this node within the current
        # evaluation batch (removed again before real backpropagation).
        self.virtual_loss = 0

    @property
    def q_value(self):
        if self.visit_count == 0:
            return 0.0
        return self.value_sum / self.visit_count

# Rank-units penalty a node picks up per in-flight simulation, steering
# concurrently collected simulations toward different branches (we minimize).
VIRTUAL_LOSS_PENALTY = 1.0

def ucb_score(parent: MCTSNode, child: MCTSNode) -> float:
    parent_visits = parent.visit_count + parent.virtual_loss
    child_total = child.visit_count + child.virtual_loss
    prior_score = C_PUCT * child.prior * math.sqrt(parent_visits) / (1 + child_total)
    if child.visit_count == 0:
        base_q = parent.q_value
    else:
        base_q = child.q_value
    if child.virtual_loss:
        q = (child.value_sum + child.virtual_loss * (base_q + VIRTUAL_LOSS_PENALTY)) / child_total
    else:
        q = base_q
    return q - prior_score

def mcts_search(root_state, net, env, num_simulations=100, add_exploration_noise=True, batch_size=8):
    root = MCTSNode(root_state)
    
    net.eval()
    with torch.no_grad():
        state_tensor = torch.tensor(root_state, dtype=torch.float32).unsqueeze(0)
        state_tensor = state_tensor.to(next(net.parameters()).device)
        p_logits, v = net(state_tensor)
        
        # Action Masking
        mask = (state_tensor[:, 0, :, :] == 0).flatten()
        p_logits_flat = p_logits.flatten()
        p_logits_flat[mask] = -1e9
        p_probs = F.softmax(p_logits_flat, dim=0).cpu().numpy()
        
        root.value_sum = v.item()
        root.visit_count = 1
        root.is_expanded = True
        
        valid_actions = np.where(root_state[0].flatten() == 1)[0]
        
        if add_exploration_noise and len(valid_actions) > 0:
            epsilon = 0.25
            alpha = max(10.0 / len(valid_actions), 0.1) # Safe fallback
            noise = np.random.dirichlet([alpha] * len(valid_actions))
        else:
            epsilon = 0.0
            noise = np.zeros(len(valid_actions))
            
        for idx, a in enumerate(valid_actions):
            prior = (1 - epsilon) * p_probs[a] + epsilon * noise[idx]
            root.children[a] = MCTSNode(state=None, parent=root, prior=prior)

    device = next(net.parameters()).device
    sims_done = 0

    while sims_done < num_simulations:
        target = min(batch_size, num_simulations - sims_done)
        pending = []
        scheduled = {}  # id(node) -> pending index of the entry expanding it

        # 1. Selection: collect up to `target` leaves under virtual loss
        for _ in range(target):
            node = root
            sim_env = clone_env_from_obs(root_state, env.m, env.n, env.cuts_made)
            search_path = [node]
            entry = None

            while node.is_expanded and not node.is_terminal:
                best_action, best_child = min(
                    node.children.items(),
                    key=lambda item: ucb_score(node, item[1])
                )
                node = best_child
                search_path.append(node)
                _, reward, terminated, _, info = sim_env.step(best_action)
                if terminated:
                    node.is_terminal = True
                    if "fragments" in info and info["fragments"]:
                        # Fragment NN evaluations are deferred into the batch
                        entry = {"kind": "fragments", "node": node,
                                 "fragments": info["fragments"], "cuts": sim_env.cuts_made}
                    else:
                        node.terminal_rank = sim_env.cuts_made

            if entry is None:
                if node.is_terminal:
                    if node.terminal_rank is not None:
                        entry = {"kind": "value", "value": node.terminal_rank}
                    else:
                        # Fragments node hit again; rank resolves earlier in this batch
                        entry = {"kind": "await_node", "node": node}
                else:
                    obs = sim_env._get_obs()
                    node.state = obs
                    if id(node) in scheduled:
                        entry = {"kind": "dup", "of": scheduled[id(node)]}
                    else:
                        active_coords = np.argwhere(obs[0] == 1)
                        verts = [{"x": int(x), "y": int(y)} for x, y in active_coords]
                        can_hash = generate_canonical_hash(verts)
                        db_res = query_tablebase([can_hash]).get(can_hash)

                        if db_res and (db_res['is_optimal'] or db_res['best_rank'] <= 3):
                            value = db_res['best_rank'] + sim_env.cuts_made
                            node.is_terminal = True
                            node.terminal_rank = value
                            entry = {"kind": "value", "value": value}
                        else:
                            entry = {"kind": "expand", "node": node, "obs": obs,
                                     "db_res": db_res, "cuts": sim_env.cuts_made}
                            scheduled[id(node)] = len(pending)

            entry["path"] = search_path
            for nd in search_path:
                nd.virtual_loss += 1
            pending.append(entry)

        # 2. Evaluation: one forward pass over all leaf and fragment states
        obs_batch = []
        slots = []  # (pending index, "leaf" | "frag", fragment index)
        for i, e in enumerate(pending):
            if e["kind"] == "expand":
                slots.append((i, "leaf", None))
                obs_batch.append(e["obs"])
            elif e["kind"] == "fragments":
                e["frag_values"] = [None] * len(e["fragments"])
                e["frag_db"] = []
                for j, frag in enumerate(e["fragments"]):
                    verts = [{"x": x, "y": y} for x, y in frag.vertices]
                    frag_hash = generate_canonical_hash(verts)
                    db_res = query_tablebase([frag_hash]).get(frag_hash)
                    e["frag_db"].append(db_res)
                    if db_res and (db_res['is_optimal'] or db_res['best_rank'] <= 3):
                        e["frag_values"][j] = float(db_res['best_rank'])
                    else:
                        frag_env = HowlEnv(env.m, env.n, generate=False)
                        frag_env.graph = frag
                        slots.append((i, "frag", j))
                        obs_batch.append(frag_env._get_obs())

        p_probs_batch = v_batch = None
        if obs_batch:
            with torch.no_grad():
                state_tensor = torch.tensor(np.stack(obs_batch), dtype=torch.float32).to(device)
                p_logits, v = net(state_tensor)

                # Action Masking (per row)
                mask = state_tensor[:, 0, :, :].reshape(state_tensor.size(0), -1) == 0
                p_logits = p_logits.masked_fill(mask, -1e9)
                p_probs_batch = F.softmax(p_logits, dim=1).cpu().numpy()
                v_batch = v.squeeze(1).cpu().numpy()

        for s_idx, (i, kind, j) in enumerate(slots):
            e = pending[i]
            if kind == "leaf":
                node = e["node"]
                db_res = e["db_res"]
                nn_val = float(v_batch[s_idx])
                if db_res and not db_res['is_optimal']:
                    nn_val = min(nn_val, float(db_res['best_rank']))
                elif not db_res:
                    nn_val = max(nn_val, 4.0)
                e["value"] = nn_val + e["cuts"]

                node.is_expanded = True
                valid_actions = np.where(e["obs"][0].flatten() == 1)[0]
                for a in valid_actions:
                    node.children[a] = MCTSNode(state=None, parent=node, prior=p_probs_batch[s_idx][a])
            else:
                # Same clamping as evaluate_fragment_rank
                db_res = e["frag_db"][j]
                nn_val = float(v_batch[s_idx])
                if db_res and not db_res['is_optimal']:
                    nn_val = min(nn_val, float(db_res['best_rank']))
                else:
                    nn_val = max(nn_val, 4.0)
                e["frag_values"][j] = nn_val

        # 3. Backpropagation: resolve in collection order, lift virtual loss
        for e in pending:
            kind = e["kind"]
            if kind == "fragments":
                value = e["cuts"] + max(e["frag_values"])
                e["node"].terminal_rank = value
                e["value"] = value
            elif kind == "await_node":
                value = e["node"].terminal_rank
                e["value"] = value
            elif kind == "dup":
                e["value"] = pending[e["of"]]["value"]

            for nd in reversed(e["path"]):
                nd.virtual_loss -= 1
                nd.visit_count += 1
                nd.value_sum += e["value"]

        sims_done += len(pending)

    return root



def play_episode(net, env, obs, num_simulations=50, add_exploration_noise=True, batch_size=8):
    state_history = []
    local_sequence = []

    while True:
        root = mcts_search(obs, net, env, num_simulations, add_exploration_noise, batch_size=batch_size)
        
        action_visits = {a: child.visit_count for a, child in root.children.items()}
        total_visits = sum(action_visits.values())
        if total_visits == 0:
            return [], env.cuts_made, []
            
        pi = np.zeros(MAX_ROWS * MAX_COLS)
        for a, visits in action_visits.items():
            pi[a] = visits / total_visits
            
        state_history.append((obs.copy(), pi, env.cuts_made, len(local_sequence)))
        
        actions = list(action_visits.keys())
        probs = [action_visits[a] / total_visits for a in actions]
        action = np.random.choice(actions, p=probs)
        
        local_sequence.append({"t": "c", "v": [[int(action // MAX_COLS), int(action % MAX_COLS)]]})
        
        obs, reward, terminated, _, info = env.step(action)
        
        if "duplicates" in info and info["duplicates"]:
            for dup_frag in info["duplicates"]:
                dup_vertices = [[int(x), int(y)] for x, y in dup_frag.vertices]
                local_sequence.append({"t": "i", "v": dup_vertices})
        
        if terminated:
            frag_ranks = []
            recursive_trajectories = []
            recursive_cuts = []
            recursive_discoveries = []
            
            if "fragments" in info and info["fragments"]:
                for frag in info["fragments"]:
                    # Create an isolated environment for this fragment
                    frag_env = HowlEnv(env.m, env.n, generate=False)
                    frag_env.graph = frag
                    frag_env.cuts_made = 0
                    frag_obs = frag_env._get_obs()
                    
                    active_coords = np.argwhere(frag_obs[0] == 1)
                    verts = [{"x": int(x), "y": int(y)} for x, y in active_coords]
                    can_hash = generate_canonical_hash(verts)
                    db_res_dict = query_tablebase([can_hash])
                    db_res = db_res_dict.get(can_hash)
                    
                    if db_res and (db_res['is_optimal'] or db_res['best_rank'] <= 3):
                        frag_ranks.append(db_res['best_rank'])
                        frag_vertices = [[int(x), int(y)] for x, y in frag.vertices]
                        recursive_cuts.append({"t": "v", "v": frag_vertices, "r": int(db_res['best_rank'])})
                    else:
                        frag_traj, frag_rank, frag_discoveries = play_episode(net, frag_env, frag_obs, num_simulations, add_exploration_noise, batch_size=batch_size)
                        frag_ranks.append(frag_rank)
                        recursive_trajectories.extend(frag_traj)
                        recursive_cuts.extend(frag_discoveries[0][2] if frag_discoveries else [])
                        recursive_discoveries.extend(frag_discoveries)
            
            max_frag_rank = max(frag_ranks) if frag_ranks else 0
            total_rank = env.cuts_made + max_frag_rank
            
            final_sequence = local_sequence + recursive_cuts
            
            local_trajectory = []
            local_discoveries = []
            for i, (state, policy, cuts_at_state, seq_idx) in enumerate(state_history):
                intrinsic_rank = total_rank - cuts_at_state
                local_discoveries.append((state.copy(), intrinsic_rank, final_sequence[seq_idx:]))
                
                pyg_data = grid_tensor_to_pyg_data(torch.tensor(state, dtype=torch.float32))
                pyg_data.pi = torch.tensor(policy, dtype=torch.float32).unsqueeze(0)
                pyg_data.v = torch.tensor([intrinsic_rank], dtype=torch.float32).unsqueeze(0)
                local_trajectory.append(pyg_data)
                    
            return local_trajectory + recursive_trajectories, total_rank, local_discoveries + recursive_discoveries

def simulate_game_worker(worker_args):
    m, n, model_state_dict, num_simulations, game_id, mcts_batch_size = worker_args
    
    local_device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    torch.set_num_threads(1) # Prevent OpenMP deadlocks in multiprocessing
    net = AlphaWolfNet(m, n)
    net.load_state_dict(model_state_dict)
    net.to(local_device)
    net.eval()
    
    env = HowlEnv(m, n)
    obs, _ = env.reset()
    traj, final_rank, discoveries = play_episode(net, env, obs, num_simulations, batch_size=mcts_batch_size)
    
    # We must move PyG tensors back to CPU before pickling them back to the main process
    # to avoid CUDA IPC memory issues across process boundaries
    for data in traj:
        data = data.to('cpu')
        
    return game_id, m, n, traj, final_rank, discoveries

def self_play(net, gm_gn_list, num_simulations=50, num_workers=5, mcts_batch_size=8):
    import concurrent.futures
    import time
    
    replay_buffer = []
    
    # Extract state dict on CPU to send to workers
    model_state_dict = {k: v.cpu() for k, v in net.state_dict().items()}
    
    worker_args_list = []
    for game_id, (m, n) in enumerate(gm_gn_list):
        worker_args_list.append((m, n, model_state_dict, num_simulations, game_id + 1, mcts_batch_size))
        
    num_games = len(gm_gn_list)
    print(f"\n[PHASE 1] Self-Play ({num_games} games | {num_workers} workers)")
    print("-" * 60)
    
    start_time = time.time()
    ranks = []
    lengths = []
    completed = 0
    
    import multiprocessing as mp
    with concurrent.futures.ProcessPoolExecutor(max_workers=num_workers, mp_context=mp.get_context('spawn')) as executor:
        futures = [executor.submit(simulate_game_worker, args) for args in worker_args_list]
        
        for future in concurrent.futures.as_completed(futures):
            game_id, m, n, traj, final_rank, discoveries = future.result()
            replay_buffer.extend(traj)
            
            ranks.append(final_rank)
            lengths.append(len(traj))
            completed += 1
            
            # Main Thread Gatekeeping: Sequential SQLite Writes to avoid locking
            for state, rank, seq in discoveries:
                active_coords = np.argwhere(state[0] == 1)
                verts = [{"x": int(x), "y": int(y)} for x, y in active_coords]
                can_data = generate_canonical_data(verts)
                upsert_subgraph(can_data["hash"], can_data["shape_str"], rank, seq)
                
            if discoveries:
                final_sequence = discoveries[0][2]
                upsert_grid_solution(m, n, final_rank, final_sequence)
            
            # Nicer Terminal Output
            progress = f"[{completed}/{num_games}]"
            grid_str = f"{m}x{n}"
            print(f"  {progress:<9} Grid: {grid_str:<5} | Rank: {final_rank:<3} | Nodes: {len(traj):<3} | Worker Game: #{game_id}")
            
    elapsed = time.time() - start_time
    avg_rank = sum(ranks) / len(ranks) if ranks else 0
    avg_len = sum(lengths) / len(lengths) if lengths else 0
    print("-" * 60)
    print(f"  Self-Play Summary: {elapsed:.1f}s | Avg Rank: {avg_rank:.1f} | Avg Nodes: {avg_len:.1f} | Total Data: +{len(replay_buffer)}")
    
    return replay_buffer

def train_network(net, replay_buffer, optimizer, epochs=5, batch_size=32):
    import time
    print(f"\n[PHASE 2] Network Training ({len(replay_buffer)} total samples in buffer)")
    print("-" * 60)
    
    net.train()
    
    from torch_geometric.loader import DataLoader as PyGDataLoader
    buffer_list = list(replay_buffer)
    
    loader = PyGDataLoader(buffer_list, batch_size=batch_size, shuffle=True)
    
    start_time = time.time()
    for epoch in range(epochs):
        total_p_loss = 0
        total_v_loss = 0
        
        for batch in loader:
            optimizer.zero_grad()
            batch = batch.to(next(net.parameters()).device)
            p_logits, v_pred = net(batch)
            
            p_loss = F.cross_entropy(p_logits, batch.pi)
            v_loss = F.mse_loss(v_pred.squeeze(-1), batch.v.squeeze(-1))
            loss = p_loss + 0.5 * v_loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            optimizer.step()
            total_p_loss += p_loss.item()
            total_v_loss += v_loss.item()
            
        avg_p_loss = total_p_loss / len(loader)
        avg_v_loss = total_v_loss / len(loader)
        print(f"  Epoch {epoch+1:<2}/{epochs:<2} | Policy Loss: {avg_p_loss:8.4f} | Value Loss: {avg_v_loss:8.4f}")
        
    elapsed = time.time() - start_time
    print("-" * 60)
    print(f"  Training Summary: {elapsed:.1f}s | Final P_Loss: {avg_p_loss:8.4f} | Final V_Loss: {avg_v_loss:8.4f}")

def alpha_zero_loop(m, n, num_generations=50, games_per_generation=15, num_simulations=200, num_workers=5, mcts_batch_size=8, self_play_min_grid=4, self_play_max_grid=9):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Main Process using device: {device}")
    
    net = AlphaWolfNet(m, n).to(device)
    optimizer = optim.Adam(net.parameters(), lr=1e-3, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=num_generations, eta_min=1e-5)
    
    replay_buffer = collections.deque(maxlen=30000)
    
    os.makedirs("models/checkpoints", exist_ok=True)
    print(f"Initialized AlphaWolf V1 [{m}x{n}] - Multi-Process Worker Mode")
    print(f"MCTS Simulations per move: {num_simulations}")
    print(f"Replay Buffer Capacity: {replay_buffer.maxlen} samples")
    
    for gen in range(1, num_generations + 1):
        print(f"\n{'='*40}")
        print(f"          GENERATION {gen}/{num_generations}")
        print(f"{'='*40}")
        
        import random
        # Collect games symmetrically across the configured size range
        lo = self_play_min_grid
        hi = min(self_play_max_grid, MAX_ROWS, MAX_COLS)
        gm_gn_list = []
        for game_idx in range(games_per_generation):
            gm = random.randint(lo, hi)
            gn = random.randint(lo, hi)
            gm_gn_list.append((gm, gn))
            
        new_trajectories = self_play(net, gm_gn_list, num_simulations=num_simulations, num_workers=num_workers, mcts_batch_size=mcts_batch_size)
            
        replay_buffer.extend(new_trajectories)
        
        train_network(net, replay_buffer, optimizer, epochs=5, batch_size=32)
        scheduler.step()
        
        ckpt_path = f"models/checkpoints/alphawolf_gen_{gen}.pt"
        torch.save(net.state_dict(), ckpt_path)
        
        print(f"\n[PHASE 3] Validation & Checkpointing")
        print("-" * 60)
        print(f"  Saved Checkpoint: {ckpt_path}")
        
        # Benchmark Suite Promotion Check
        from benchmark import promote_model
        promote_model(ckpt_path)

if __name__ == "__main__":
    import json
    import os
    
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    with open(config_path, "r") as f:
        config = json.load(f)
        
    m = config.get("current_m", 5)
    n = config.get("current_n", 5)
    num_generations = config.get("total_generations", 50)
    games_per_gen = config.get("games_per_generation", 15)
    simulations = config.get("mcts_simulations", 200)
    num_workers = config.get("num_workers", 5)
    
    mcts_batch_size = config.get("mcts_batch_size", 8)
    self_play_min_grid = config.get("self_play_min_grid", 4)
    self_play_max_grid = config.get("self_play_max_grid", 9)

    alpha_zero_loop(m, n, num_generations=num_generations, games_per_generation=games_per_gen, num_simulations=simulations, num_workers=num_workers, mcts_batch_size=mcts_batch_size, self_play_min_grid=self_play_min_grid, self_play_max_grid=self_play_max_grid)
