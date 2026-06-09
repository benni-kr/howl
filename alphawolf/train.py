import math
import os
import numpy as np
import torch
import torch.nn.functional as F
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

from models.net import AlphaWolfNet
from envs.howl_env import HowlEnv
from db.tablebase import query_tablebase, insert_or_update_rank4_induction
from core_engine.hashing import generate_canonical_hash

C_PUCT = 1.0

class MCTSNode:
    def __init__(self, state, parent=None, prior=0.0):
        self.state = state          # The grid shape matrix
        self.parent = parent
        self.children = {}          # action_id -> MCTSNode
        self.visit_count = 0
        self.value_sum = 0.0        # Sum of ranks (cost)
        self.prior = prior
        
        self.is_terminal = False
        self.terminal_rank = None
        
        # In HOWL, cutting a vertex might split the graph. 
        # The environment handles the MAX() of fragments implicitly, 
        # returning the isolated fragments in the info dict if we need strict AND-node branching.
        # For V1, we treat the state as the whole board and rely on the NN to learn the MAX relationship,
        # or we explicitly handle fragments if provided.
        self.is_expanded = False

    @property
    def q_value(self):
        if self.visit_count == 0:
            return 0.0
        return self.value_sum / self.visit_count

def ucb_score(parent: MCTSNode, child: MCTSNode) -> float:
    """
    PUCT formula for MINIMIZING cost (rank).
    We want to pick children with LOW Q-values. 
    To encourage exploration, we SUBTRACT the exploration term from Q (since lower is better).
    Wait, if Q is cost, we want to MINIMIZE Q. 
    So score = Q - c_puct * P * sqrt(N) / (1 + n).
    Actually, standard way: invert costs to rewards. Let's just minimize:
    """
    prior_score = C_PUCT * child.prior * math.sqrt(parent.visit_count) / (1 + child.visit_count)
    
    if child.visit_count == 0:
        # If unvisited, its Q is unknown. We use the parent's value or a heuristic.
        # Let's assume unvisited nodes have the parent's Q.
        q = parent.q_value
    else:
        q = child.q_value
        
    # We are picking the action that MINIMIZES this score
    # UCB for cost minimization: Q - exploration
    return q - prior_score

def mcts_search(root_state, net, env, num_simulations=100):
    root = MCTSNode(root_state)
    
    # Pre-evaluate root
    net.eval()
    with torch.no_grad():
        state_tensor = torch.tensor(root_state, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
        p_logits, v = net(state_tensor)
        p_probs = F.softmax(p_logits.flatten(), dim=0).numpy()
        root.value_sum = v.item()
        root.visit_count = 1
        root.is_expanded = True
        
        # Expand root
        valid_actions = np.where(root_state.flatten() == 1)[0]
        for a in valid_actions:
            root.children[a] = MCTSNode(state=None, parent=root, prior=p_probs[a])

    for _ in range(num_simulations):
        node = root
        env.reset()
        # Fast-forward env to current node state if necessary (omitted for pure placeholder)
        
        search_path = [node]
        
        # 1. Selection
        while node.is_expanded and not node.is_terminal:
            # Pick action that MINIMIZES ucb_score
            best_action, best_child = min(
                node.children.items(), 
                key=lambda item: ucb_score(node, item[1])
            )
            node = best_child
            search_path.append(node)
            # Step env
            _, reward, terminated, _, info = env.step(best_action)
            if terminated:
                node.is_terminal = True
                # Tablebase or exact rank
                node.terminal_rank = env.cuts_made  # Simplified

        value = 0.0
        # 2. Expansion and Evaluation
        if node.is_terminal:
            value = node.terminal_rank
        else:
            obs = env._get_obs()
            node.state = obs
            
            # Canonicalize and query tablebase
            active_coords = np.argwhere(obs == 1)
            verts = [{"x": int(x), "y": int(y)} for x, y in active_coords]
            can_hash = generate_canonical_hash(verts)
            db_res_dict = query_tablebase([can_hash])
            db_res = db_res_dict.get(can_hash)
            
            if db_res and (db_res['is_optimal'] or db_res['best_rank'] <= 3):
                # Absolute Truth
                value = db_res['best_rank'] + env.cuts_made
                node.is_terminal = True
                node.terminal_rank = value
            else:
                with torch.no_grad():
                    state_tensor = torch.tensor(obs, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
                    p_logits, v = net(state_tensor)
                    p_probs = F.softmax(p_logits.flatten(), dim=0).numpy()
                    nn_val = v.item()
                
                if db_res and not db_res['is_optimal']:
                    # Heuristic Ceiling
                    nn_val = min(nn_val, db_res['best_rank'])
                    
                value = nn_val + env.cuts_made
                
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
    """
    Returns the 8 D4 symmetries of the state and policy.
    state: 2D numpy array (m x n)
    pi: 1D numpy array of size m*n
    """
    m, n = state.shape
    pi_2d = pi.reshape((m, n))
    symmetries = []
    
    for i in range(4):
        rot_state = np.rot90(state, k=i)
        rot_pi = np.rot90(pi_2d, k=i)
        symmetries.append((rot_state.copy(), rot_pi.flatten()))
        
        # Reflection
        flip_state = np.fliplr(rot_state)
        flip_pi = np.fliplr(rot_pi)
        symmetries.append((flip_state.copy(), flip_pi.flatten()))
        
    return symmetries

def self_play(net, m, n, num_games=10, num_simulations=50):
    env = HowlEnv(m, n)
    replay_buffer = []
    
    for game in range(num_games):
        obs, _ = env.reset()
        state_history = []
        
        while True:
            # Run MCTS
            root = mcts_search(obs, net, env, num_simulations)
            
            # Extract Policy from visit counts
            action_visits = {a: child.visit_count for a, child in root.children.items()}
            total_visits = sum(action_visits.values())
            if total_visits == 0:
                break
                
            # Policy vector (size m*n)
            pi = np.zeros(m * n)
            for a, visits in action_visits.items():
                pi[a] = visits / total_visits
                
            state_history.append((obs.copy(), pi, env.cuts_made))
            
            # Choose action (for self-play, typically sample proportional to visit counts)
            actions = list(action_visits.keys())
            probs = [action_visits[a] / total_visits for a in actions]
            action = np.random.choice(actions, p=probs)
            
            # Step env
            obs, reward, terminated, _, info = env.step(action)
            
            if terminated:
                final_rank = env.cuts_made
                for state, policy, cuts_at_state in state_history:
                    intrinsic_rank = final_rank - cuts_at_state
                    
                    # Data Augmentation: 8 D4 Symmetries
                    syms = get_symmetries(state, policy)
                    for s, p in syms:
                        replay_buffer.append((s, p, intrinsic_rank))
                        
                print(f"Game {game+1} finished with Total Rank {final_rank}")
                break
                
    return replay_buffer

def train_network(net, replay_buffer, optimizer, epochs=5, batch_size=32):
    net.train()
    
    # Unpack buffer
    states = torch.tensor(np.array([item[0] for item in replay_buffer]), dtype=torch.float32).unsqueeze(1)
    policies = torch.tensor(np.array([item[1] for item in replay_buffer]), dtype=torch.float32)
    values = torch.tensor(np.array([item[2] for item in replay_buffer]), dtype=torch.float32).unsqueeze(1)
    
    dataset = TensorDataset(states, policies, values)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    
    for epoch in range(epochs):
        total_p_loss = 0
        total_v_loss = 0
        
        for batch_s, batch_p, batch_v in loader:
            optimizer.zero_grad()
            
            p_logits, v_pred = net(batch_s)
            
            # Policy loss: Cross Entropy between logits and target distribution
            p_loss = F.cross_entropy(p_logits.view(p_logits.size(0), -1), batch_p)
            
            # Value loss: Mean Squared Error (Intrinsic Rank prediction)
            v_loss = F.mse_loss(v_pred, batch_v)
            
            loss = p_loss + v_loss
            loss.backward()
            optimizer.step()
            
            total_p_loss += p_loss.item()
            total_v_loss += v_loss.item()
            
        print(f"Epoch {epoch+1}/{epochs} | P_Loss: {total_p_loss/len(loader):.4f} | V_Loss: {total_v_loss/len(loader):.4f}")

def alpha_zero_loop(m, n, num_generations=5):
    net = AlphaWolfNet(m, n)
    optimizer = optim.Adam(net.parameters(), lr=1e-3)
    
    os.makedirs("models/checkpoints", exist_ok=True)
    print(f"Initialized AlphaWolf V1 [{m}x{n}] - Strict Single-Threaded Mode")
    
    for gen in range(1, num_generations + 1):
        print(f"\n--- Generation {gen} ---")
        print("Starting Self-Play Phase...")
        # Play games to generate data
        buffer = self_play(net, m, n, num_games=5, num_simulations=50)
        
        print(f"Training Phase ({len(buffer)} samples)...")
        train_network(net, buffer, optimizer, epochs=5)
        
        ckpt_path = f"models/checkpoints/alphawolf_gen_{gen}.pt"
        torch.save(net.state_dict(), ckpt_path)
        print(f"Saved Checkpoint: {ckpt_path}")

if __name__ == "__main__":
    alpha_zero_loop(4, 4, num_generations=2)
