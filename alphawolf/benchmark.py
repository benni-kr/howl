import concurrent.futures
import hashlib
import io
import json
import multiprocessing as mp
import os
import random
import shutil
import sys
import time
import torch
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

from envs.howl_env import HowlEnv
from core_engine.graph_logic import GridGraph
from models.net import AlphaWolfNet
from train import play_episode


def create_gauntlet(fractured_per_tier=1, fracture_min=0.1, fracture_max=0.3, min_size=4, max_size=None):
    """Returns a list of dicts defining the benchmark boards.

    Dynamically generates benchmark tiers based on max_size (configured from config.json).
    For sizes up to 9: exhaustive rectangular pairs.
    For sizes > 9: all square grids up to max_size plus representative aspect ratios.
    """
    if max_size is None:
        try:
            config_path = os.path.join(os.path.dirname(__file__), "config.json")
            if os.path.exists(config_path):
                with open(config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                max_size = cfg.get("self_play_max_grid", 9)
        except Exception:
            max_size = 9

    if max_size <= 9:
        unlocked_tiers = [(i, j) for i in range(min_size, max_size + 1) for j in range(min_size, max_size + 1) if i <= j]
    else:
        # Core dense foundation tiers up to 8x8
        tiers = [(i, j) for i in range(min_size, 9) for j in range(min_size, 9) if i <= j]
        # Extended large tiers: all square boards and key rectangular bisection challenges
        for k in range(9, max_size + 1):
            tiers.append((k, k))
            if k % 2 == 0 or k == max_size:
                tiers.append((max(min_size, k // 2), k))
                tiers.append((k - 2, k))
        unlocked_tiers = sorted(list(set(tiers)))
        
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


def compute_file_sha256(file_path: str) -> str:
    """Computes SHA-256 hash of a file."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def compute_gauntlet_hash(gauntlet_boards: list, num_simulations: int, mcts_batch_size: int) -> str:
    """Computes deterministic hash for a gauntlet configuration."""
    raw = {
        "boards": gauntlet_boards,
        "num_simulations": num_simulations,
        "mcts_batch_size": mcts_batch_size,
    }
    json_bytes = json.dumps(raw, sort_keys=True).encode("utf-8")
    return hashlib.sha256(json_bytes).hexdigest()


def get_benchmark_meta_path(model_path: str) -> str:
    """Returns the sidecar metadata JSON path for a model checkpoint."""
    base, _ = os.path.splitext(model_path)
    return f"{base}.meta.json"


def load_benchmark_cache(model_path: str, gauntlet_boards: list, num_simulations: int = 100, mcts_batch_size: int = 1) -> tuple[int, int, float] | None:
    """
    Loads cached benchmark results if the model file hash and gauntlet config match.
    """
    if not os.path.exists(model_path):
        return None
    meta_path = get_benchmark_meta_path(model_path)
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        cur_file_hash = compute_file_sha256(model_path)
        cur_gauntlet_hash = compute_gauntlet_hash(gauntlet_boards, num_simulations, mcts_batch_size)
        if meta.get("model_file_sha256") == cur_file_hash and meta.get("gauntlet_config_hash") == cur_gauntlet_hash:
            return int(meta["cumulative_rank"]), int(meta["trajectory_nodes"]), float(meta.get("execution_time", 0.0))
    except Exception:
        pass
    return None


def save_benchmark_cache(model_path: str, gauntlet_boards: list, cumulative_rank: int, trajectory_nodes: int, execution_time: float, num_simulations: int = 100, mcts_batch_size: int = 1) -> str:
    """
    Atomically saves benchmark evaluation results to sidecar JSON.
    """
    meta_path = get_benchmark_meta_path(model_path)
    os.makedirs(os.path.dirname(os.path.abspath(meta_path)), exist_ok=True)
    payload = {
        "model_file_sha256": compute_file_sha256(model_path) if os.path.exists(model_path) else None,
        "gauntlet_config_hash": compute_gauntlet_hash(gauntlet_boards, num_simulations, mcts_batch_size),
        "cumulative_rank": cumulative_rank,
        "trajectory_nodes": trajectory_nodes,
        "execution_time": round(execution_time, 2),
        "num_simulations": num_simulations,
        "mcts_batch_size": mcts_batch_size,
        "num_boards": len(gauntlet_boards),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    tmp_path = meta_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    if os.path.exists(meta_path):
        os.replace(tmp_path, meta_path)
    else:
        os.rename(tmp_path, meta_path)
    return meta_path


def evaluate_board_worker(worker_args):
    """
    Worker function to evaluate a single gauntlet board with isolated model instance.
    """
    board, model_bytes, num_simulations, mcts_batch_size = worker_args
    torch.set_num_threads(1)
    local_device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    net = AlphaWolfNet()
    net.load_state_dict(torch.load(io.BytesIO(model_bytes), map_location=local_device, weights_only=True))
    net.to(local_device)
    net.eval()
    
    m, n, missing = board["m"], board["n"], board["missing"]
    env = HowlEnv(m, n)
    obs, _ = env.reset()
    
    # Carve out the pre-shattered missing vertices
    for (x, y) in missing:
        if (x, y) in env.graph.vertices:
            env.graph.apply_cut_set([(x, y)])
            
    obs = env._get_obs()
    
    traj, rank, _ = play_episode(
        net, env, obs,
        num_simulations=num_simulations,
        add_exploration_noise=False,
        batch_size=mcts_batch_size,
        greedy=True
    )
    return rank, len(traj)


def evaluate_model(model_path, gauntlet_boards, num_simulations=100, mcts_batch_size=8, num_workers=5, use_cache=True):
    """
    Evaluates a model against a gauntlet of test boards.
    Supports multi-worker parallel execution and persistent caching.
    """
    if not os.path.exists(model_path):
        return float('inf'), float('inf'), 0.0

    if use_cache:
        cached = load_benchmark_cache(model_path, gauntlet_boards, num_simulations, mcts_batch_size)
        if cached is not None:
            return cached

    start_time = time.time()
    
    # Instantiate the network on CPU to extract state_dict bytes for workers
    net = AlphaWolfNet()
    try:
        from checkpoint import load_checkpoint
        load_checkpoint(model_path, net, device=torch.device('cpu'))
    except Exception as e:
        print(f"Warning: Failed to load model weights for {model_path} ({e}). Yielding invalid scores.")
        return float('inf'), float('inf'), 0.0
        
    model_buf = io.BytesIO()
    torch.save(net.state_dict(), model_buf)
    model_bytes = model_buf.getvalue()
    
    actual_workers = min(num_workers, len(gauntlet_boards)) if num_workers and num_workers > 1 else 1
    
    cumulative_rank = 0
    total_node_expansions = 0
    
    if actual_workers <= 1:
        for board in gauntlet_boards:
            r, n = evaluate_board_worker((board, model_bytes, num_simulations, mcts_batch_size))
            cumulative_rank += r
            total_node_expansions += n
    else:
        worker_args_list = [(board, model_bytes, num_simulations, mcts_batch_size) for board in gauntlet_boards]
        with concurrent.futures.ProcessPoolExecutor(max_workers=actual_workers, mp_context=mp.get_context('spawn')) as executor:
            futures = [executor.submit(evaluate_board_worker, args) for args in worker_args_list]
            for future in concurrent.futures.as_completed(futures):
                r, n = future.result()
                cumulative_rank += r
                total_node_expansions += n
                
    execution_time = time.time() - start_time
    
    if use_cache:
        save_benchmark_cache(model_path, gauntlet_boards, cumulative_rank, total_node_expansions, execution_time, num_simulations, mcts_batch_size)
        
    return cumulative_rank, total_node_expansions, execution_time


_DEFAULT_BEST_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models/checkpoints/best_model.pt")


def promote_model(new_model_path, best_model_path=_DEFAULT_BEST_MODEL_PATH, num_workers=5, num_simulations=100, mcts_batch_size=8, max_size=None):
    """
    Evaluates new_model against best_model using the gauntlet.
    Promotes challenger if strictly better rank or equal rank with fewer nodes.
    Reuses cached baseline score whenever available.
    """
    gauntlet = create_gauntlet(max_size=max_size)
    
    if not os.path.exists(best_model_path):
        print(f"No best_model.pt found. Bootstrapping with {new_model_path}")
        shutil.copy(new_model_path, best_model_path)
        rank, nodes, t = evaluate_model(best_model_path, gauntlet, num_simulations=num_simulations, mcts_batch_size=mcts_batch_size, num_workers=num_workers, use_cache=True)
        return True
        
    # Check baseline cache first
    cached_baseline = load_benchmark_cache(best_model_path, gauntlet, num_simulations, mcts_batch_size)
    if cached_baseline is not None:
        best_rank, best_nodes, best_time = cached_baseline
        print(f"\nBaseline Score (Cached): Rank: {best_rank}, Trajectory Nodes: {best_nodes} (0.00s)")
    else:
        print(f"\nEvaluating Baseline: {best_model_path}...")
        best_rank, best_nodes, best_time = evaluate_model(best_model_path, gauntlet, num_simulations=num_simulations, mcts_batch_size=mcts_batch_size, num_workers=num_workers, use_cache=True)
        
    print(f"Evaluating Challenger: {new_model_path}...")
    new_rank, new_nodes, new_time = evaluate_model(new_model_path, gauntlet, num_simulations=num_simulations, mcts_batch_size=mcts_batch_size, num_workers=num_workers, use_cache=True)
    
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
        # Atomically update baseline cache with challenger's evaluated score
        save_benchmark_cache(best_model_path, gauntlet, new_rank, new_nodes, new_time, num_simulations, mcts_batch_size)
        
    return promoted
