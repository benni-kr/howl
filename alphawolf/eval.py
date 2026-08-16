import os
import torch
import numpy as np

from envs.howl_env import HowlEnv
from models.net import AlphaWolfNet
from train import play_episode
from core_engine.hashing import generate_canonical_data
from db.tablebase import upsert_subgraph, upsert_grid_solution

def evaluate_high_simulations(m, n, num_simulations=1000, num_games=10):
    model_path = "models/checkpoints/best_model.pt"
    if not os.path.exists(model_path):
        print(f"Error: {model_path} not found.")
        return

    print(f"Loading {model_path} for {m}x{n} evaluation with {num_simulations} MCTS simulations...")
    net = AlphaWolfNet()
    net.load_state_dict(torch.load(model_path, map_location=torch.device('cpu')))
    net.eval()

    best_rank = float('inf')
    best_traj = None
    best_discoveries = None

    print(f"Starting {num_games} MCTS Monte Carlo Rollouts (this will take a while)...")
    for game in range(num_games):
        env = HowlEnv(m, n)
        obs, _ = env.reset()
        
        # batch_size=1: results are upserted to the tablebase, so solution
        # quality outranks speed here (leaf batching costs a few % rank).
        traj, final_rank, discoveries = play_episode(net, env, obs, num_simulations=num_simulations, add_exploration_noise=True, batch_size=1)
        print(f"Game {game+1}/{num_games} - Rank Achieved: {final_rank}")
        
        if final_rank < best_rank:
            best_rank = final_rank
            best_traj = traj
            best_discoveries = discoveries

    print(f"\nEvaluation Finished!")
    print(f"Best Final Rank Achieved: {best_rank}")
    print(f"Total Sequence Length (Trajectory Nodes): {len(best_traj)}")

    if best_discoveries:
        print("\nUpserting best discoveries to database...")
        for state, rank, seq in best_discoveries:
            active_coords = np.argwhere(state[0] == 1)
            verts = [{"x": int(x), "y": int(y)} for x, y in active_coords]
            can_data = generate_canonical_data(verts)
            upsert_subgraph(can_data["hash"], can_data["shape_str"], rank, seq)
            
        final_sequence = best_discoveries[0][2]
        upsert_grid_solution(m, n, best_rank, final_sequence)
        print("Upsert complete.")

if __name__ == "__main__":
    import json
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    with open(config_path, "r") as f:
        config = json.load(f)
    evaluate_high_simulations(config.get("current_m", 7), config.get("current_n", 7), num_simulations=1000, num_games=10)
