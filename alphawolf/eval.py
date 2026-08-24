import os
import sys
import torch
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

from envs.howl_env import HowlEnv
from models.net import AlphaWolfNet
from train import play_episode
from core_engine.hashing import generate_canonical_data
from db.tablebase import validate_and_upsert_solution

def evaluate_high_simulations(m, n, num_simulations=1000, num_games=10, solver_name="alphawolf2"):
    model_path = os.path.join(os.path.dirname(__file__), "models/checkpoints/best_model.pt")
    if not os.path.exists(model_path):
        print(f"Error: {model_path} not found.")
        return

    print(f"Loading {model_path} for {m}x{n} evaluation with {num_simulations} MCTS simulations (solver: '{solver_name}')...")
    net = AlphaWolfNet()
    from checkpoint import load_checkpoint
    load_checkpoint(model_path, net, device=torch.device('cpu'))
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
        print("\nValidating and upserting best discoveries to database...")
        final_sequence = best_discoveries[0][2]
        saved = validate_and_upsert_solution(m, n, best_rank, final_sequence, solver_name=solver_name)
        if saved:
            print("Replay validation passed and database upsert complete.")
        else:
            print("Warning: Solution rejected by replay validation; database not modified.")

if __name__ == "__main__":
    import json
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    with open(config_path, "r") as f:
        config = json.load(f)
    evaluate_high_simulations(
        config.get("current_m", 7),
        config.get("current_n", 7),
        num_simulations=1000,
        num_games=10,
        solver_name=config.get("solver_name", "alphawolf2")
    )
