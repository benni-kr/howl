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

def evaluate_high_simulations(m=7, n=None, num_simulations=1000, num_games=10, solver_name="alphawolf2.3", model_path=None):
    if n is None:
        n = m

    ckpt_dir = os.path.join(os.path.dirname(__file__), "models/checkpoints")
    if model_path is None:
        model_path = os.path.join(ckpt_dir, "best_model.pt")
        if not os.path.exists(model_path):
            from checkpoint import resolve_checkpoint_path
            model_path = resolve_checkpoint_path("best_model.pt", ckpt_dir)
    else:
        from checkpoint import resolve_checkpoint_path
        resolved = resolve_checkpoint_path(model_path, ckpt_dir)
        if resolved:
            model_path = resolved

    if not model_path or not os.path.exists(model_path):
        print(f"Error: Checkpoint not found at {model_path}.")
        return

    print(f"Loading {model_path} for {m}x{n} evaluation with {num_simulations} MCTS simulations (solver: '{solver_name}')...")
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    net = AlphaWolfNet().to(device)
    from checkpoint import load_checkpoint
    load_checkpoint(model_path, net, device=device)
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
    import argparse
    import json

    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    config = {}
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="AlphaWolf High-Simulation Evaluation")
    parser.add_argument("--m", type=int, default=None, help="Grid rows (height). Default: 7")
    parser.add_argument("--n", type=int, default=None, help="Grid columns (width). Defaults to m if omitted.")
    parser.add_argument("--sims", type=int, default=None, help="MCTS simulations per move (default: 1000)")
    parser.add_argument("--games", type=int, default=None, help="Number of games to evaluate (default: 10)")
    parser.add_argument("--solver-name", type=str, default=None, help="Solver alias for DB submissions (default: alphawolf2.3)")
    parser.add_argument("--checkpoint", type=str, default=None, help="Path or filename of model checkpoint to evaluate")

    args = parser.parse_args()

    m = args.m if args.m is not None else 7
    n = args.n if args.n is not None else m
    num_simulations = args.sims or 1000
    num_games = args.games or 10
    solver_name = args.solver_name or config.get("solver_name", "alphawolf2.3")
    checkpoint = args.checkpoint

    evaluate_high_simulations(
        m=m,
        n=n,
        num_simulations=num_simulations,
        num_games=num_games,
        solver_name=solver_name,
        model_path=checkpoint,
    )
