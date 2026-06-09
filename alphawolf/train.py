import math
import numpy as np
import torch
import torch.nn.functional as F

from models.net import AlphaWolfNet
from envs.howl_env import HowlEnv
from db.tablebase import query_tablebase, insert_or_update_rank4_induction

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
            
            with torch.no_grad():
                state_tensor = torch.tensor(obs, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
                p_logits, v = net(state_tensor)
                p_probs = F.softmax(p_logits.flatten(), dim=0).numpy()
                value = v.item() + env.cuts_made # Value is estimated remaining cuts + current cuts
                
            node.is_expanded = True
            valid_actions = np.where(obs.flatten() == 1)[0]
            for a in valid_actions:
                node.children[a] = MCTSNode(state=None, parent=node, prior=p_probs[a])
                
        # 3. Backpropagation
        for n in reversed(search_path):
            n.visit_count += 1
            n.value_sum += value

    return root

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
                
            state_history.append((obs.copy(), pi))
            
            # Choose action (for self-play, typically sample proportional to visit counts)
            actions = list(action_visits.keys())
            probs = [action_visits[a] / total_visits for a in actions]
            action = np.random.choice(actions, p=probs)
            
            # Step env
            obs, reward, terminated, _, info = env.step(action)
            
            if terminated:
                final_rank = env.cuts_made
                for state, policy in state_history:
                    replay_buffer.append((state, policy, final_rank))
                print(f"Game {game+1} finished with Rank {final_rank}")
                break
                
    return replay_buffer

if __name__ == "__main__":
    env = HowlEnv(4, 4)
    net = AlphaWolfNet(4, 4)
    print("MCTS initialized with Treedepth Minimization PUCT.")
    
    print("Starting 1 game of self-play...")
    replay_buffer = self_play(net, 4, 4, num_games=1, num_simulations=50)
    print(f"Replay buffer populated with {len(replay_buffer)} states.")
