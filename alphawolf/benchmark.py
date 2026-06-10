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
    import json
    import os
    import random
    
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    try:
        with open(config_path, "r") as f:
            config = json.load(f)
        unlocked_tiers = config.get("unlocked_tiers", [[4, 4], [5, 5], [6, 6]])
        fractured_per_tier = config.get("gauntlet_fractured_per_tier", 2)
        fracture_min = config.get("gauntlet_fracture_min", 0.1)
        fracture_max = config.get("gauntlet_fracture_max", 0.2)
    except Exception:
        unlocked_tiers = [[4, 4], [5, 5], [6, 6]]
        fractured_per_tier = 2
        fracture_min = 0.1
        fracture_max = 0.2
        
    gauntlet = []
    
    # We want reproducible randomness for the benchmark so it's a stable metric
    rng = random.Random(42)
    
    for tier in unlocked_tiers:
        m, n = tier
        
        # 1. Clean perfect rectangle
        gauntlet.append({"m": m, "n": n, "missing": []})
        
        # 2. Asymmetric boards
        for _ in range(fractured_per_tier):
            num_missing = rng.randint(max(1, int(m*n * fracture_min)), max(2, int(m*n * fracture_max)))
            all_coords = [(r, c) for r in range(m) for c in range(n)]
            missing = rng.sample(all_coords, num_missing)
            gauntlet.append({"m": m, "n": n, "missing": missing})
            
    return gauntlet

def evaluate_model(model_path, gauntlet_boards, num_simulations=100):
    if not os.path.exists(model_path):
        return float('inf'), float('inf'), 0.0

    cumulative_rank = 0
    total_node_expansions = 0
    start_time = time.time()
    
    # Instantiate the network. Currently locked to 4x4 due to Linear layer dimensions.
    net = AlphaWolfNet() # Defaults to 10x10 zero-padded format
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
                env.graph.apply_cut_set([(x, y)])
                
        # Run deterministic evaluation (add_exploration_noise=False)
        traj, rank, _ = play_episode(net, env, obs, num_simulations=num_simulations, add_exploration_noise=False)
        
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
