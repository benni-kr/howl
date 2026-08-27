import math
import os
import sys
import collections
import numpy as np
import torch
import torch.nn.functional as F
import torch.optim as optim
from torch.utils.data import DataLoader
from torch_geometric.data import Batch, Data
import torch_geometric.utils as pyg_utils

sys.path.insert(0, os.path.dirname(__file__))

from models.net import AlphaWolfNet, grid_tensor_to_pyg_data
from envs.howl_env import HowlEnv, MAX_ROWS, MAX_COLS
from db.tablebase import query_tablebase, insert_or_update_rank4_induction, upsert_subgraph, upsert_grid_solution, validate_and_upsert_solution
from core_engine.hashing import generate_canonical_hash, generate_canonical_data
from core_engine.graph_logic import GridGraph

C_PUCT = 1.0

def clone_env(src_env, current_cuts=None):
    """Copy an env by duplicating its adjacency map. Much cheaper than
    rebuilding from an observation, and yields an identical graph."""
    sim_env = HowlEnv(src_env.m, src_env.n, generate=False)
    sim_env.graph.vertices = set(src_env.graph.vertices)
    sim_env.graph.adjacency = {v: set(s) for v, s in src_env.graph.adjacency.items()}
    sim_env.cuts_made = src_env.cuts_made if current_cuts is None else current_cuts
    sim_env.cuts_in_turn = set(src_env.cuts_in_turn)
    return sim_env

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
    sim_env.cuts_in_turn = set()
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

def mcts_search(root_state, net, env, num_simulations=100, add_exploration_noise=True, batch_size=8, enable_perimeter_mask=True):
    root = MCTSNode(root_state)
    
    net.eval()
    with torch.no_grad():
        root_data = env.to_pyg_data(device=next(net.parameters()).device, perimeter_only=enable_perimeter_mask)
        p_logits, v = net(root_data)
        
        # Single-graph node softmax with perimeter action masking
        masked_p_logits = p_logits.clone()
        if hasattr(root_data, "legal_mask") and root_data.legal_mask is not None and root_data.legal_mask.numel() > 0:
            masked_p_logits[~root_data.legal_mask] = -1e9
        p_probs = F.softmax(masked_p_logits, dim=0).cpu().numpy()
        
        root.value_sum = v.item()
        root.visit_count = 1
        root.is_expanded = True
        
        coords = [(int(x), int(y)) for x, y in root_data.coords.cpu().numpy()]
        legal_mask_np = root_data.legal_mask.cpu().numpy() if (hasattr(root_data, "legal_mask") and root_data.legal_mask is not None) else np.ones(len(coords), dtype=bool)
        legal_indices = [idx for idx in range(len(coords)) if legal_mask_np[idx]]
        num_legal = len(legal_indices)
        
        if add_exploration_noise and num_legal > 0:
            epsilon = 0.25
            alpha = max(10.0 / num_legal, 0.1) # Safe fallback
            noise = np.random.dirichlet([alpha] * num_legal)
        else:
            epsilon = 0.0
            noise = np.zeros(num_legal)
            
        for k, idx in enumerate(legal_indices):
            coord = coords[idx]
            prior = (1 - epsilon) * float(p_probs[idx]) + epsilon * float(noise[k])
            root.children[coord] = MCTSNode(state=None, parent=root, prior=prior)

    device = next(net.parameters()).device
    sims_done = 0

    # Direct graph cloning from active env
    root_env = clone_env(env)

    while sims_done < num_simulations:
        target = min(batch_size, num_simulations - sims_done)
        pending = []
        scheduled = {}  # id(node) -> pending index of the entry expanding it

        # 1. Selection: collect up to `target` leaves under virtual loss
        for _ in range(target):
            node = root
            sim_env = clone_env(root_env)
            search_path = [node]
            entry = None

            while node.is_expanded and not node.is_terminal:
                best_action, best_child = min(
                    node.children.items(),
                    key=lambda item: ucb_score(node, item[1])
                )
                node = best_child
                search_path.append(node)
                # Observation is only needed at the leaf, not during descent
                _, reward, terminated, _, info = sim_env.step(best_action, compute_obs=False)
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
                    # Reaching here means the last step was non-terminal,
                    # so the graph is exactly one component
                    obs = sim_env._get_obs(components=[sim_env.graph.vertices])
                    node.state = obs
                    if id(node) in scheduled:
                        entry = {"kind": "dup", "of": scheduled[id(node)]}
                    else:
                        verts = [{"x": int(x), "y": int(y)} for x, y in sim_env.graph.vertices]
                        can_hash = generate_canonical_hash(verts)
                        db_res = query_tablebase([can_hash]).get(can_hash)

                        if db_res and (db_res['is_optimal'] or db_res['best_rank'] <= 3):
                            value = db_res['best_rank'] + sim_env.cuts_made
                            node.is_terminal = True
                            node.terminal_rank = value
                            entry = {"kind": "value", "value": value}
                        else:
                            pyg_data = sim_env.to_pyg_data(perimeter_only=enable_perimeter_mask)
                            entry = {"kind": "expand", "node": node, "pyg_data": pyg_data,
                                     "db_res": db_res, "cuts": sim_env.cuts_made}
                            scheduled[id(node)] = len(pending)

            entry["path"] = search_path
            for nd in search_path:
                nd.virtual_loss += 1
            pending.append(entry)

        # 2. Evaluation: one forward pass over all leaf and fragment states
        pyg_data_batch = []
        slots = []  # (pending index, "leaf" | "frag", fragment index)
        for i, e in enumerate(pending):
            if e["kind"] == "expand":
                slots.append((i, "leaf", None))
                pyg_data_batch.append(e["pyg_data"])
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
                        pyg_data_batch.append(frag_env.to_pyg_data(perimeter_only=enable_perimeter_mask))

        node_probs_all = v_batch = batch_indices = None
        if pyg_data_batch:
            with torch.no_grad():
                batch = Batch.from_data_list(pyg_data_batch).to(device)
                p_logits, v = net(batch)
                import torch_geometric.utils as pyg_utils
                masked_batch_logits = p_logits.clone()
                if hasattr(batch, 'legal_mask') and batch.legal_mask is not None:
                    masked_batch_logits[~batch.legal_mask] = -1e9
                node_probs_all = pyg_utils.softmax(masked_batch_logits, batch.batch).cpu().numpy()
                v_batch = v.squeeze(-1).cpu().numpy()
                batch_indices = batch.batch.cpu().numpy()

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
                leaf_data = pyg_data_batch[s_idx]
                leaf_coords = [(int(x), int(y)) for x, y in leaf_data.coords.cpu().numpy()]
                slot_probs = node_probs_all[batch_indices == s_idx]
                leaf_legal = leaf_data.legal_mask.cpu().numpy() if (hasattr(leaf_data, 'legal_mask') and leaf_data.legal_mask is not None) else np.ones(len(leaf_coords), dtype=bool)
                for idx, coord in enumerate(leaf_coords):
                    if leaf_legal[idx]:
                        node.children[coord] = MCTSNode(state=None, parent=node, prior=float(slot_probs[idx]))
            else:
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



def play_episode(net, env, obs=None, num_simulations=50, add_exploration_noise=True, batch_size=8, greedy=False, temperature=1.0, enable_perimeter_mask=True):
    if obs is None:
        obs, _ = env.reset()
    state_history = []
    local_sequence = []

    while True:
        root = mcts_search(obs, net, env, num_simulations, add_exploration_noise, batch_size=batch_size, enable_perimeter_mask=enable_perimeter_mask)
        
        action_visits = {coord: child.visit_count for coord, child in root.children.items()}
        total_visits = sum(action_visits.values())
        if total_visits == 0:
            return [], env.cuts_made, []
            
        pyg_data = env.to_pyg_data(perimeter_only=enable_perimeter_mask)
        coords = [(int(x), int(y)) for x, y in pyg_data.coords.cpu().numpy()]
        node_pi = np.array([action_visits.get(c, 0.0) / total_visits for c in coords], dtype=np.float32)
        
        state_history.append((pyg_data, node_pi, env.cuts_made, len(local_sequence)))
        
        if greedy or not add_exploration_noise:
            action = max(action_visits, key=action_visits.get)
        else:
            actions = list(action_visits.keys())
            if temperature != 1.0 and temperature > 0:
                visits = np.array([action_visits[a] for a in actions], dtype=np.float64)
                visits = visits ** (1.0 / temperature)
                sum_visits = np.sum(visits)
                probs = visits / sum_visits if sum_visits > 0 else [1.0 / len(actions)] * len(actions)
            else:
                probs = [action_visits[a] / total_visits for a in actions]
            action_idx = np.random.choice(len(actions), p=probs)
            action = actions[action_idx]
        
        local_sequence.append({"t": "c", "v": [[int(action[0]), int(action[1])]]})
        
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
                    frag_env = HowlEnv(env.m, env.n, generate=False)
                    frag_env.graph = frag
                    frag_env.cuts_made = 0
                    frag_obs = frag_env._get_obs()
                    
                    verts = [{"x": int(x), "y": int(y)} for x, y in frag.vertices]
                    can_hash = generate_canonical_hash(verts)
                    db_res_dict = query_tablebase([can_hash])
                    db_res = db_res_dict.get(can_hash)
                    
                    if db_res and (db_res['is_optimal'] or db_res['best_rank'] <= 3):
                        frag_ranks.append(db_res['best_rank'])
                        frag_vertices = [[int(x), int(y)] for x, y in frag.vertices]
                        recursive_cuts.append({"t": "v", "v": frag_vertices, "r": int(db_res['best_rank'])})
                    else:
                        frag_traj, frag_rank, frag_discoveries = play_episode(
                            net, frag_env, frag_obs, num_simulations,
                            add_exploration_noise=add_exploration_noise,
                            batch_size=batch_size,
                            greedy=greedy,
                            temperature=temperature,
                            enable_perimeter_mask=enable_perimeter_mask
                        )
                        frag_ranks.append(frag_rank)
                        recursive_trajectories.extend(frag_traj)
                        recursive_cuts.extend(frag_discoveries[0][2] if frag_discoveries else [])
                        recursive_discoveries.extend(frag_discoveries)
            
            max_frag_rank = max(frag_ranks) if frag_ranks else 0
            total_rank = env.cuts_made + max_frag_rank
            
            final_sequence = local_sequence + recursive_cuts
            
            local_trajectory = []
            local_discoveries = []
            for i, (pyg_data, node_pi, cuts_at_state, seq_idx) in enumerate(state_history):
                intrinsic_rank = total_rank - cuts_at_state
                local_discoveries.append((None, intrinsic_rank, final_sequence[seq_idx:]))
                
                pyg_data.node_pi = torch.tensor(node_pi, dtype=torch.float32)
                pyg_data.v = torch.tensor([intrinsic_rank], dtype=torch.float32).unsqueeze(0)
                local_trajectory.append(pyg_data)
                    
            return local_trajectory + recursive_trajectories, total_rank, local_discoveries + recursive_discoveries

def simulate_game_worker(worker_args):
    import io
    m, n, model_bytes, num_simulations, game_id, mcts_batch_size, enable_perimeter_mask = worker_args
    
    local_device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    torch.set_num_threads(1) # Prevent OpenMP deadlocks in multiprocessing
    net = AlphaWolfNet(m, n)
    net.load_state_dict(torch.load(io.BytesIO(model_bytes), map_location=local_device, weights_only=True))
    net.to(local_device)
    net.eval()
    
    env = HowlEnv(m, n)
    obs, _ = env.reset()
    traj, final_rank, discoveries = play_episode(net, env, obs, num_simulations, batch_size=mcts_batch_size, enable_perimeter_mask=enable_perimeter_mask)
    
    # Serialize PyG trajectory to plain bytes to avoid PyTorch IPC shared-memory leaks across processes
    for data in traj:
        data.x = data.x.cpu()
        data.edge_index = data.edge_index.cpu()
        data.coords = data.coords.cpu()
        data.node_pi = data.node_pi.cpu()
        data.v = data.v.cpu()
        if hasattr(data, "flat_indices"):
            data.flat_indices = data.flat_indices.cpu()
        if hasattr(data, "pi"):
            data.pi = data.pi.cpu()
        
    traj_buf = io.BytesIO()
    torch.save(traj, traj_buf)
    
    return game_id, m, n, traj_buf.getvalue(), final_rank, discoveries

def self_play(net, gm_gn_list, num_simulations=50, num_workers=5, mcts_batch_size=8, solver_name="alphawolf2", enable_perimeter_mask=True):
    import concurrent.futures
    import io
    import time
    
    replay_buffer = []
    
    # Serialize state dict to bytes to send to workers cleanly
    model_buf = io.BytesIO()
    torch.save(net.state_dict(), model_buf)
    model_bytes = model_buf.getvalue()
    
    worker_args_list = []
    for game_id, (m, n) in enumerate(gm_gn_list):
        worker_args_list.append((m, n, model_bytes, num_simulations, game_id + 1, mcts_batch_size, enable_perimeter_mask))
        
    num_games = len(gm_gn_list)
    print(f"\n[PHASE 1] Self-Play ({num_games} games | {num_workers} workers | solver: '{solver_name}')")
    print("-" * 60)
    print(f"Game      | Time     | Grid  | Rank | Nodes | Worker")
    print("-" * 60)
    
    start_time = time.time()
    ranks = []
    lengths = []
    completed = 0
    game_results = []
    
    import multiprocessing as mp
    with concurrent.futures.ProcessPoolExecutor(max_workers=num_workers, mp_context=mp.get_context('spawn')) as executor:
        futures = [executor.submit(simulate_game_worker, args) for args in worker_args_list]
        
        for future in concurrent.futures.as_completed(futures):
            game_id, m, n, traj_bytes, final_rank, discoveries = future.result()
            traj = torch.load(io.BytesIO(traj_bytes), map_location='cpu', weights_only=False)
            replay_buffer.extend(traj)
            
            ranks.append(final_rank)
            lengths.append(len(traj))
            completed += 1
            game_results.append((m, n, final_rank))
            
            # Main Thread Gatekeeping: Replay Engine Validation & Sequential SQLite Writes
            if discoveries:
                final_sequence = discoveries[0][2]
                validate_and_upsert_solution(m, n, final_rank, final_sequence, solver_name=solver_name)
            
            # Nicer Terminal Output
            progress = f"[{completed}/{num_games}]"
            grid_str = f"{m}x{n}"
            current_time = time.strftime("%H:%M:%S")
            print(f"{progress:<9} | {current_time:<8} | {grid_str:<5} | {final_rank:<4} | {len(traj):<5} | #{game_id}")
            
    elapsed = time.time() - start_time
    avg_rank = sum(ranks) / len(ranks) if ranks else 0
    avg_len = sum(lengths) / len(lengths) if lengths else 0
    print("-" * 60)
    print(f"  Self-Play Summary: {elapsed:.1f}s | Avg Rank: {avg_rank:.1f} | Avg Nodes: {avg_len:.1f} | Total Data: +{len(replay_buffer)}")
    
    return replay_buffer, game_results

def train_network(net, replay_buffer, optimizer, epochs=5, batch_size=32):
    import time
    print(f"\n[PHASE 2] Network Training ({len(replay_buffer)} total samples in buffer)")
    print("-" * 60)
    
    net.train()
    
    from torch_geometric.loader import DataLoader as PyGDataLoader
    import torch_geometric.utils as pyg_utils
    buffer_list = list(replay_buffer)
    
    loader = PyGDataLoader(buffer_list, batch_size=batch_size, shuffle=True)
    
    start_time = time.time()
    for epoch in range(epochs):
        total_p_loss = 0
        total_v_loss = 0
        
        for batch in loader:
            optimizer.zero_grad()
            batch = batch.to(next(net.parameters()).device)
            node_p_logits, v_pred = net(batch)
            
            # PyG Segmented Softmax Loss across variable graph sizes
            log_probs = pyg_utils.softmax(node_p_logits, batch.batch).clamp(min=1e-12).log()
            p_loss = -torch.sum(batch.node_pi * log_probs) / batch.num_graphs
            v_loss = F.mse_loss(v_pred.squeeze(-1), batch.v.squeeze(-1))
            loss = p_loss + 0.5 * v_loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            optimizer.step()
            total_p_loss += p_loss.item()
            total_v_loss += v_loss.item()
            
        avg_p_loss = total_p_loss / len(loader) if len(loader) > 0 else 0.0
        avg_v_loss = total_v_loss / len(loader) if len(loader) > 0 else 0.0
        print(f"  Epoch {epoch+1:<2}/{epochs:<2} | Policy Loss: {avg_p_loss:8.4f} | Value Loss: {avg_v_loss:8.4f}")
        
    elapsed = time.time() - start_time
    print("-" * 60)
    print(f"  Training Summary: {elapsed:.1f}s | Final P_Loss: {avg_p_loss:8.4f} | Final V_Loss: {avg_v_loss:8.4f}")
    return {"policy_loss": avg_p_loss, "value_loss": avg_v_loss}

def alpha_zero_loop(
    m,
    n,
    num_generations=50,
    games_per_generation=15,
    num_simulations=200,
    num_workers=5,
    mcts_batch_size=8,
    self_play_min_grid=4,
    self_play_max_grid=9,
    solver_name="alphawolf2",
    resume_from=None,
    curriculum_mode="hybrid",
    curriculum_stages=None,
    curriculum_frontier_ratio=0.70,
    curriculum_success_threshold=0.80,
    enable_perimeter_mask=True,
):
    from checkpoint import (
        load_checkpoint,
        save_checkpoint,
        save_replay_buffer,
        load_replay_buffer,
        resolve_checkpoint_path,
        DEFAULT_CHECKPOINT_DIR,
    )
    from curriculum import CurriculumManager

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Main Process using device: {device}")
    
    net = AlphaWolfNet(m, n).to(device)
    optimizer = optim.Adam(net.parameters(), lr=1e-3, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=num_generations, eta_min=1e-5)
    
    replay_buffer = collections.deque(maxlen=30000)
    
    ckpt_dir = os.path.join(os.path.dirname(__file__), "models/checkpoints")
    os.makedirs(ckpt_dir, exist_ok=True)

    curriculum = CurriculumManager(
        mode=curriculum_mode,
        min_grid=self_play_min_grid,
        max_grid=self_play_max_grid,
        total_generations=num_generations,
        frontier_ratio=curriculum_frontier_ratio,
        success_threshold=curriculum_success_threshold,
        stages=curriculum_stages,
    )

    start_gen = 1
    if resume_from:
        resolved_ckpt = resolve_checkpoint_path(resume_from, ckpt_dir)
        if resolved_ckpt:
            try:
                last_gen, meta = load_checkpoint(resolved_ckpt, net, optimizer=optimizer, scheduler=scheduler, device=device)
                start_gen = last_gen + 1
                if "curriculum_state" in meta and meta["curriculum_state"]:
                    curriculum.load_state_dict(meta["curriculum_state"])
                    print(f"[RESUME] Restored curriculum state: {curriculum.active_stage.get('name', 'Active Stage')} (Max Grid: {curriculum.current_max_size}x{curriculum.current_max_size})")
                
                # Restore rolling replay buffer if present
                buffer_file = os.path.join(ckpt_dir, "replay_buffer.pt")
                if os.path.exists(buffer_file):
                    restored_samples = load_replay_buffer(buffer_file, max_samples=replay_buffer.maxlen)
                    if restored_samples:
                        replay_buffer.extend(restored_samples)
                        print(f"[RESUME] Restored {len(restored_samples)} samples from rolling replay buffer ({buffer_file})")

                print(f"\n[RESUME] Successfully loaded checkpoint: {resolved_ckpt}")
                if last_gen > 0:
                    print(f"[RESUME] Resuming training from Generation {start_gen} to {num_generations}")
                else:
                    print(f"[RESUME] Loaded baseline weights. Training from Generation 1 to {num_generations}")
            except Exception as e:
                print(f"\n[RESUME] Warning: Failed to load {resolved_ckpt} ({e}). Starting fresh from Generation 1.")
        else:
            print(f"\n[RESUME] Warning: Checkpoint target '{resume_from}' not found. Starting fresh from Generation 1.")

    print(f"\nInitialized AlphaWolf V1 [{m}x{n}] - Multi-Process Worker Mode (solver: '{solver_name}')")
    print(f"MCTS Simulations per move: {num_simulations}")
    print(f"Replay Buffer Capacity: {replay_buffer.maxlen} samples")
    print(f"Curriculum Mode: '{curriculum.mode.upper()}' | Active Max Grid: {curriculum.current_max_size}x{curriculum.current_max_size}")

    if start_gen > num_generations:
        print(f"\n[NOTICE] Checkpoint generation ({start_gen - 1}) is >= total_generations ({num_generations}). Nothing to run.")
        return
    
    for gen in range(start_gen, num_generations + 1):
        print(f"\n{'='*40}")
        print(f"          GENERATION {gen}/{num_generations}")
        print(f"{'='*40}")
        
        stage = curriculum.active_stage
        print(f"[CURRICULUM] Stage: {stage.get('name', 'Active')} (Max Grid: {curriculum.current_max_size}x{curriculum.current_max_size})")

        gm_gn_list = curriculum.sample_games(games_per_generation, gen)
            
        new_trajectories, game_results = self_play(net, gm_gn_list, num_simulations=num_simulations, num_workers=num_workers, mcts_batch_size=mcts_batch_size, solver_name=solver_name, enable_perimeter_mask=enable_perimeter_mask)
            
        replay_buffer.extend(new_trajectories)

        cur_summary = curriculum.record_generation_results(gen, game_results)
        met_cnt = cur_summary["games_met_target"]
        tot_cnt = cur_summary["total_games"]
        succ_pct = cur_summary["success_rate"]
        print(f"  Curriculum Mastery: {met_cnt}/{tot_cnt} games ({succ_pct:.1%}) met R_target")
        if cur_summary["advanced"]:
            next_stage = curriculum.active_stage
            print(f"  >>> STAGE PROMOTION! Reason: {cur_summary['advance_reason']}")
            print(f"  >>> Advancing to: {next_stage.get('name', 'Next Stage')} (New Max Grid: {curriculum.current_max_size}x{curriculum.current_max_size})")
        
        loss_metrics = train_network(net, replay_buffer, optimizer, epochs=5, batch_size=32)
        scheduler.step()
        
        ckpt_path = os.path.join(ckpt_dir, f"alphawolf_gen_{gen}.pt")
        save_checkpoint(
            ckpt_path,
            net,
            optimizer=optimizer,
            scheduler=scheduler,
            generation=gen,
            solver_name=solver_name,
            metrics=loss_metrics,
            curriculum_state=curriculum.state_dict(),
        )

        # Atomically update rolling replay buffer
        buffer_file = os.path.join(ckpt_dir, "replay_buffer.pt")
        save_replay_buffer(replay_buffer, buffer_file, max_samples=replay_buffer.maxlen)
        
        print(f"\n[PHASE 3] Validation & Checkpointing")
        print("-" * 60)
        print(f"  Saved Checkpoint: {ckpt_path}")
        
        # Benchmark Suite Promotion Check
        from benchmark import promote_model
        promote_model(ckpt_path, num_workers=num_workers)

if __name__ == "__main__":
    import argparse
    import json
    import os
    
    parser = argparse.ArgumentParser(description="AlphaWolf AlphaZero Training Pipeline")
    parser.add_argument("--resume", nargs="?", const="latest", default=None, help="Resume training from checkpoint ('latest', 'best', or file path)")
    parser.add_argument("--fresh", action="store_true", help="Force fresh start from Generation 1 with random weights")
    parser.add_argument("--curriculum", type=str, default=None, choices=["hybrid", "staged", "linear", "uniform"], help="Curriculum learning mode")
    parser.add_argument("--no-curriculum", action="store_true", help="Disable curriculum (equivalent to --curriculum uniform)")
    parser.add_argument("--generations", type=int, default=None, help="Total generations to train")
    parser.add_argument("--games-per-gen", type=int, default=None, help="Games per generation")
    parser.add_argument("--sims", type=int, default=None, help="MCTS simulations per move")
    parser.add_argument("--workers", type=int, default=None, help="Number of worker processes")
    parser.add_argument("--solver-name", type=str, default=None, help="Solver alias for DB submissions")

    args = parser.parse_args()

    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    with open(config_path, "r") as f:
        config = json.load(f)
        
    m = config.get("current_m", 5)
    n = config.get("current_n", 5)
    num_generations = args.generations or config.get("total_generations", 50)
    games_per_gen = args.games_per_gen or config.get("games_per_generation", 15)
    simulations = args.sims or config.get("mcts_simulations", 200)
    num_workers = args.workers or config.get("num_workers", 5)
    mcts_batch_size = config.get("mcts_batch_size", 8)
    self_play_min_grid = config.get("self_play_min_grid", 4)
    self_play_max_grid = config.get("self_play_max_grid", 9)
    solver_name = args.solver_name or config.get("solver_name", "alphawolf2")

    if args.fresh:
        resume_from = None
    elif args.resume is not None:
        resume_from = args.resume
    else:
        resume_from = config.get("resume_from", None)

    if args.no_curriculum:
        curriculum_mode = "uniform"
    elif args.curriculum is not None:
        curriculum_mode = args.curriculum
    else:
        curriculum_mode = config.get("curriculum_mode", "hybrid")

    alpha_zero_loop(
        m,
        n,
        num_generations=num_generations,
        games_per_generation=games_per_gen,
        num_simulations=simulations,
        num_workers=num_workers,
        mcts_batch_size=mcts_batch_size,
        self_play_min_grid=self_play_min_grid,
        self_play_max_grid=self_play_max_grid,
        solver_name=solver_name,
        resume_from=resume_from,
        curriculum_mode=curriculum_mode,
        curriculum_stages=config.get("curriculum_stages", None),
        curriculum_frontier_ratio=config.get("curriculum_frontier_ratio", 0.70),
        curriculum_success_threshold=config.get("curriculum_success_threshold", 0.80),
        enable_perimeter_mask=config.get("enable_perimeter_mask", True),
    )
