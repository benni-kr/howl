import os
import time
import shutil
import torch
import numpy as np

from envs.howl_env import HowlEnv
from core_engine.graph_logic import GridGraph
from models.net import AlphaWolfNet
from train import play_episode

def create_gauntlet():
    """Returns a list of dicts defining the benchmark boards."""
    return [
        {"m": 4, "n": 4, "missing": []},
        
        # NOTE: AlphaWolfNet currently uses Linear layers (e.g., nn.Linear(2 * m * n, m * n))
        # which hardcodes the input dimensions. A checkpoint trained on 4x4 CANNOT be loaded 
        # and evaluated on 5x5, 6x6, or 4x5 grids without throwing a Tensor Size Mismatch error.
        # To evaluate these boards, we must refactor AlphaWolfNet to be Fully Convolutional 
        # or implement 0-padding to a maximum board size.
        # 
        # {"m": 5, "n": 5, "missing": []},
        # {"m": 6, "n": 6, "missing": []},
        # {"m": 4, "n": 5, "missing": [(0, 0), (1, 1), (3, 4)]},
        # {"m": 4, "n": 5, "missing": [(1, 2), (2, 2)]},
        # {"m": 4, "n": 5, "missing": [(0, 4), (1, 3), (2, 2), (3, 1)]},
        
        # Testing asymmetric topologies on the supported 4x4 grid size for now:
        {"m": 4, "n": 4, "missing": [(0, 0), (1, 1), (3, 3)]},
        {"m": 4, "n": 4, "missing": [(1, 2), (2, 2)]},
        {"m": 4, "n": 4, "missing": [(0, 3), (1, 3), (2, 2), (3, 1)]}
    ]

def evaluate_model(model_path, gauntlet_boards, num_simulations=100):
    if not os.path.exists(model_path):
        return float('inf'), float('inf'), 0.0

    cumulative_rank = 0
    total_node_expansions = 0
    start_time = time.time()
    
    # Instantiate the network. Currently locked to 4x4 due to Linear layer dimensions.
    net = AlphaWolfNet(4, 4)
    net.load_state_dict(torch.load(model_path, map_location=torch.device('cpu')))
    net.eval()

    for board in gauntlet_boards:
        m, n, missing = board["m"], board["n"], board["missing"]
        
        env = HowlEnv(m, n)
        obs, _ = env.reset()
        
        # Carve out the pre-shattered missing vertices
        for (x, y) in missing:
            obs[x, y] = 0
            if (x, y) in env.graph.vertices:
                env.graph._remove_vertex((x, y))
                
        # Run deterministic evaluation (add_exploration_noise=False)
        traj, rank = play_episode(net, env, obs, num_simulations=num_simulations, add_exploration_noise=False)
        
        cumulative_rank += rank
        
        # The number of unique states processed in the trajectory is an excellent proxy 
        # for total_node_expansions. A smaller trajectory means the MCTS found the optimal 
        # fracture path much faster and with fewer recursive AND-node splinters.
        total_node_expansions += len(traj)
        
    execution_time = time.time() - start_time
    return cumulative_rank, total_node_expansions, execution_time

def promote_model(new_model_path, best_model_path="models/checkpoints/best_model.pt"):
    gauntlet = create_gauntlet()
    
    if not os.path.exists(best_model_path):
        print(f"No best_model.pt found. Bootstrapping with {new_model_path}")
        shutil.copy(new_model_path, best_model_path)
        return True
        
    print(f"\nEvaluating Baseline: {best_model_path}...")
    best_rank, best_nodes, best_time = evaluate_model(best_model_path, gauntlet)
    
    print(f"Evaluating Challenger: {new_model_path}...")
    new_rank, new_nodes, new_time = evaluate_model(new_model_path, gauntlet)
    
    print(f"\n--- Benchmark Arena Results ---")
    print(f"Baseline   -> Rank: {best_rank}, Trajectory Nodes: {best_nodes}, Time: {best_time:.2f}s")
    print(f"Challenger -> Rank: {new_rank}, Trajectory Nodes: {new_nodes}, Time: {new_time:.2f}s")
    
    promoted = False
    if new_rank < best_rank:
        print("Challenger achieved a STRICTLY BETTER cumulative rank! PROMOTED.")
        promoted = True
    elif new_rank == best_rank:
        if new_nodes < best_nodes:
            print("Challenger matched rank but explored fewer nodes (higher confidence)! PROMOTED.")
            promoted = True
        else:
            print("Challenger matched rank but was less efficient. REJECTED.")
    else:
        print("Challenger performed worse. REJECTED.")
        
    if promoted:
        shutil.copy(new_model_path, best_model_path)
        
    return promoted
