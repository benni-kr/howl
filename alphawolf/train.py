import math
import os
import collections
import numpy as np
import torch
import torch.nn.functional as F
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

from models.net import AlphaWolfNet
from envs.howl_env import HowlEnv
from db.tablebase import query_tablebase, insert_or_update_rank4_induction, upsert_subgraph, upsert_grid_solution
from core_engine.hashing import generate_canonical_hash
from core_engine.graph_logic import GridGraph

C_PUCT = 1.0

def clone_env_from_obs(obs, m, n, current_cuts=0):
    sim_env = HowlEnv(m, n)
    sim_env.graph = GridGraph(m, n, generate=False)
    active_coords = np.argwhere(obs == 1)
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
        
    frag_obs = np.zeros((10, 10), dtype=np.int8)
    for x, y in frag.vertices:
        frag_obs[x, y] = 1
        
    with torch.no_grad():
        state_tensor = torch.tensor(frag_obs, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
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

    @property
    def q_value(self):
        if self.visit_count == 0:
            return 0.0
        return self.value_sum / self.visit_count

def ucb_score(parent: MCTSNode, child: MCTSNode) -> float:
    prior_score = C_PUCT * child.prior * math.sqrt(parent.visit_count) / (1 + child.visit_count)
    if child.visit_count == 0:
        q = parent.q_value
    else:
        q = child.q_value
    return q - prior_score

def mcts_search(root_state, net, env, num_simulations=100, add_exploration_noise=True):
    root = MCTSNode(root_state)
    
    net.eval()
    with torch.no_grad():
        state_tensor = torch.tensor(root_state, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
        p_logits, v = net(state_tensor)
        
        # Action Masking
        mask = (state_tensor == 0).flatten()
        p_logits_flat = p_logits.flatten()
        p_logits_flat[mask] = -1e9
        p_probs = F.softmax(p_logits_flat, dim=0).numpy()
        
        root.value_sum = v.item()
        root.visit_count = 1
        root.is_expanded = True
        
        valid_actions = np.where(root_state.flatten() == 1)[0]
        
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

    for _ in range(num_simulations):
        node = root
        sim_env = clone_env_from_obs(root_state, env.m, env.n, env.cuts_made)
        
        search_path = [node]
        
        # 1. Selection
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
                    frag_ranks = [evaluate_fragment_rank(f, env.m, env.n, net) for f in info["fragments"]]
                    node.terminal_rank = sim_env.cuts_made + max(frag_ranks)
                else:
                    node.terminal_rank = sim_env.cuts_made

        value = 0.0
        # 2. Expansion and Evaluation
        if node.is_terminal:
            value = node.terminal_rank
        else:
            obs = sim_env._get_obs()
            node.state = obs
            
            active_coords = np.argwhere(obs == 1)
            verts = [{"x": int(x), "y": int(y)} for x, y in active_coords]
            can_hash = generate_canonical_hash(verts)
            db_res_dict = query_tablebase([can_hash])
            db_res = db_res_dict.get(can_hash)
            
            if db_res and (db_res['is_optimal'] or db_res['best_rank'] <= 3):
                value = db_res['best_rank'] + sim_env.cuts_made
                node.is_terminal = True
                node.terminal_rank = value
            else:
                with torch.no_grad():
                    state_tensor = torch.tensor(obs, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
                    p_logits, v = net(state_tensor)
                    
                    # Action Masking
                    mask = (state_tensor == 0).flatten()
                    p_logits_flat = p_logits.flatten()
                    p_logits_flat[mask] = -1e9
                    p_probs = F.softmax(p_logits_flat, dim=0).numpy()
                    
                    nn_val = v.item()
                
                if db_res and not db_res['is_optimal']:
                    nn_val = min(nn_val, float(db_res['best_rank']))
                elif not db_res:
                    nn_val = max(nn_val, 4.0)
                    
                value = nn_val + sim_env.cuts_made
                
                node.is_expanded = True
                valid_actions = np.where(obs.flatten() == 1)[0]
                for a in valid_actions:
                    node.children[a] = MCTSNode(state=None, parent=node, prior=p_probs[a])
                
        # 3. Backpropagation
        for n in reversed(search_path):
            n.visit_count += 1
            n.value_sum += value

    return root

def get_symmetries(state, pi):
    m, n = state.shape
    pi_2d = pi.reshape((m, n))
    symmetries = []
    
    for i in range(4):
        rot_state = np.rot90(state, k=i)
        rot_pi = np.rot90(pi_2d, k=i)
        symmetries.append((rot_state.copy(), rot_pi.flatten()))
        
        flip_state = np.fliplr(rot_state)
        flip_pi = np.fliplr(rot_pi)
        symmetries.append((flip_state.copy(), flip_pi.flatten()))
        
    return symmetries

def play_episode(net, env, obs, num_simulations=50, add_exploration_noise=True):
    state_history = []
    local_cuts_made = []
    
    while True:
        root = mcts_search(obs, net, env, num_simulations, add_exploration_noise)
        
        action_visits = {a: child.visit_count for a, child in root.children.items()}
        total_visits = sum(action_visits.values())
        if total_visits == 0:
            return [], env.cuts_made, []
            
        pi = np.zeros(obs.size)
        for a, visits in action_visits.items():
            pi[a] = visits / total_visits
            
        state_history.append((obs.copy(), pi, env.cuts_made))
        
        actions = list(action_visits.keys())
        probs = [action_visits[a] / total_visits for a in actions]
        action = np.random.choice(actions, p=probs)
        
        # Hardcoding 10 since MAX_COLS is 10
        local_cuts_made.append([int(action // 10), int(action % 10)])
        
        obs, reward, terminated, _, info = env.step(action)
        
        if terminated:
            frag_ranks = []
            recursive_trajectories = []
            recursive_cuts = []
            recursive_discoveries = []
            
            if "fragments" in info and info["fragments"]:
                for frag in info["fragments"]:
                    # Create an isolated environment for this fragment
                    frag_env = HowlEnv(env.m, env.n)
                    frag_env.graph = frag
                    frag_env.cuts_made = 0
                    frag_obs = frag_env._get_obs()
                    
                    active_coords = np.argwhere(frag_obs == 1)
                    verts = [{"x": int(x), "y": int(y)} for x, y in active_coords]
                    can_hash = generate_canonical_hash(verts)
                    db_res_dict = query_tablebase([can_hash])
                    db_res = db_res_dict.get(can_hash)
                    
                    if db_res and (db_res['is_optimal'] or db_res['best_rank'] <= 3):
                        frag_ranks.append(db_res['best_rank'])
                        frag_vertices = [[int(x), int(y)] for x, y in frag.vertices]
                        recursive_cuts.append({"t": "v", "v": frag_vertices, "r": int(db_res['best_rank'])})
                    else:
                        frag_traj, frag_rank, frag_discoveries = play_episode(net, frag_env, frag_obs, num_simulations, add_exploration_noise)
                        frag_ranks.append(frag_rank)
                        recursive_trajectories.extend(frag_traj)
                        recursive_cuts.extend(frag_discoveries[0][2] if frag_discoveries else [])
                        recursive_discoveries.extend(frag_discoveries)
            
            max_frag_rank = max(frag_ranks) if frag_ranks else 0
            total_rank = env.cuts_made + max_frag_rank
            
            local_sequence = [{"t": "c", "v": [[r, c]]} for r, c in local_cuts_made]
            final_sequence = local_sequence + recursive_cuts
            
            local_trajectory = []
            local_discoveries = []
            for i, (state, policy, cuts_at_state) in enumerate(state_history):
                intrinsic_rank = total_rank - cuts_at_state
                local_discoveries.append((state.copy(), intrinsic_rank, final_sequence[i:]))
                
                syms = get_symmetries(state, policy)
                for s, p in syms:
                    local_trajectory.append((s, p, intrinsic_rank))
                    
            return local_trajectory + recursive_trajectories, total_rank, local_discoveries + recursive_discoveries

def self_play(net, m, n, num_games=10, num_simulations=50):
    replay_buffer = []
    for game in range(num_games):
        env = HowlEnv(m, n)
        obs, _ = env.reset()
        traj, final_rank, discoveries = play_episode(net, env, obs, num_simulations)
        replay_buffer.extend(traj)
        
        # Upsert all intermediate board sequences discovered
        for state, rank, seq in discoveries:
            active_coords = np.argwhere(state == 1)
            verts = [{"x": int(x), "y": int(y)} for x, y in active_coords]
            can_hash = generate_canonical_hash(verts)
            upsert_subgraph(can_hash, rank, seq)
            
        if discoveries:
            final_sequence = discoveries[0][2]
            upsert_grid_solution(m, n, final_rank, final_sequence)
        
        print(f"Game {game+1} finished with True Total Rank {final_rank}")
    return replay_buffer

def train_network(net, replay_buffer, optimizer, epochs=5, batch_size=32):
    net.train()
    
    buffer_list = list(replay_buffer)
    states = torch.tensor(np.array([item[0] for item in buffer_list]), dtype=torch.float32).unsqueeze(1)
    policies = torch.tensor(np.array([item[1] for item in buffer_list]), dtype=torch.float32)
    values = torch.tensor(np.array([item[2] for item in buffer_list]), dtype=torch.float32).unsqueeze(1)
    
    dataset = TensorDataset(states, policies, values)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    
    for epoch in range(epochs):
        total_p_loss = 0
        total_v_loss = 0
        
        for batch_s, batch_p, batch_v in loader:
            optimizer.zero_grad()
            p_logits, v_pred = net(batch_s)
            p_loss = F.cross_entropy(p_logits.view(p_logits.size(0), -1), batch_p)
            v_loss = F.mse_loss(v_pred, batch_v)
            loss = p_loss + v_loss
            loss.backward()
            optimizer.step()
            total_p_loss += p_loss.item()
            total_v_loss += v_loss.item()
            
        print(f"Epoch {epoch+1}/{epochs} | P_Loss: {total_p_loss/len(loader):.4f} | V_Loss: {total_v_loss/len(loader):.4f}")

def alpha_zero_loop(m, n, num_generations=50, num_simulations=200):
    net = AlphaWolfNet(m, n)
    optimizer = optim.Adam(net.parameters(), lr=1e-3)
    
    replay_buffer = collections.deque(maxlen=30000)
    
    os.makedirs("models/checkpoints", exist_ok=True)
    print(f"Initialized AlphaWolf V1 [{m}x{n}] - Strict Single-Threaded Mode")
    print(f"MCTS Simulations per move: {num_simulations}")
    print(f"Replay Buffer Capacity: {replay_buffer.maxlen} samples")
    
    for gen in range(1, num_generations + 1):
        print(f"\n--- Generation {gen} ---")
        print("Starting Self-Play Phase...")
        new_trajectories = self_play(net, m, n, num_games=15, num_simulations=num_simulations)
        replay_buffer.extend(new_trajectories)
        
        print(f"Training Phase ({len(replay_buffer)} samples in buffer)...")
        train_network(net, replay_buffer, optimizer, epochs=5)
        
        ckpt_path = f"models/checkpoints/alphawolf_gen_{gen}.pt"
        torch.save(net.state_dict(), ckpt_path)
        print(f"Saved Checkpoint: {ckpt_path}")
        
        # Benchmark Suite Promotion Check
        from benchmark import promote_model
        promote_model(ckpt_path)

if __name__ == "__main__":
    alpha_zero_loop(5, 5, num_generations=50, num_simulations=200)
