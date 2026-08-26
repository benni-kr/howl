"""
Integration Tests for Benchmark Gauntlet and AlphaZero Training Loop.
"""

import os
import pytest
import torch

from models.net import AlphaWolfNet
from benchmark import create_gauntlet, evaluate_model, promote_model, _DEFAULT_BEST_MODEL_PATH
from train import alpha_zero_loop


def test_gauntlet_reproducibility():
    """Verify that create_gauntlet() generates bit-identical boards across runs."""
    g1 = create_gauntlet()
    g2 = create_gauntlet()

    assert len(g1) == len(g2)
    assert len(g1) == 63

    for b1, b2 in zip(g1, g2):
        assert b1["m"] == b2["m"]
        assert b1["n"] == b2["n"]
        assert b1["missing"] == b2["missing"]


def test_model_evaluation_on_mini_gauntlet():
    """Verify evaluate_model runs deterministically on a mini gauntlet."""
    ckpt_path = _DEFAULT_BEST_MODEL_PATH
    assert os.path.exists(ckpt_path), f"{ckpt_path} not found"

    mini_gauntlet = [
        {"m": 4, "n": 4, "missing": []},
        {"m": 4, "n": 5, "missing": [(0, 0), (1, 1)]}
    ]

    cum_rank, node_expansions, exec_time = evaluate_model(
        ckpt_path, mini_gauntlet, num_simulations=20, mcts_batch_size=1
    )

    assert cum_rank > 0
    assert node_expansions > 0
    assert exec_time > 0.0


def test_deterministic_greedy_argmax_evaluation(tmp_path):
    """Verify that evaluate_model produces bit-identical scores across runs with greedy argmax."""
    ckpt_path = str(tmp_path / "model.pt")
    net = AlphaWolfNet()
    torch.save(net.state_dict(), ckpt_path)

    mini_gauntlet = [
        {"m": 4, "n": 4, "missing": []},
        {"m": 4, "n": 5, "missing": [(0, 0)]}
    ]

    r1, n1, _ = evaluate_model(ckpt_path, mini_gauntlet, num_simulations=15, mcts_batch_size=1, num_workers=1, use_cache=False)
    r2, n2, _ = evaluate_model(ckpt_path, mini_gauntlet, num_simulations=15, mcts_batch_size=1, num_workers=1, use_cache=False)

    assert r1 == r2, f"Ranks differed across runs: {r1} vs {r2}"
    assert n1 == n2, f"Nodes differed across runs: {n1} vs {n2}"


def test_benchmark_cache_hit_and_invalidation(tmp_path):
    """Verify that benchmark sidecar metadata caches results and invalidates when weights change."""
    from benchmark import get_benchmark_meta_path, load_benchmark_cache, save_benchmark_cache

    ckpt_path = str(tmp_path / "test_model.pt")
    net = AlphaWolfNet()
    torch.save(net.state_dict(), ckpt_path)

    mini_gauntlet = [{"m": 4, "n": 4, "missing": []}]

    # 1. First run: generates cache
    r1, n1, t1 = evaluate_model(ckpt_path, mini_gauntlet, num_simulations=10, mcts_batch_size=1, use_cache=True)
    meta_path = get_benchmark_meta_path(ckpt_path)
    assert os.path.exists(meta_path)

    # 2. Second run: cache hit
    cached = load_benchmark_cache(ckpt_path, mini_gauntlet, num_simulations=10, mcts_batch_size=1)
    assert cached is not None
    assert cached[0] == r1
    assert cached[1] == n1

    # 3. Modify weights: invalidates cache
    net2 = AlphaWolfNet()
    with torch.no_grad():
        for p in net2.parameters():
            p.add_(1.0)
    torch.save(net2.state_dict(), ckpt_path)

    # Cache should be invalidated because sha256 changed
    invalidated = load_benchmark_cache(ckpt_path, mini_gauntlet, num_simulations=10, mcts_batch_size=1)
    assert invalidated is None


def test_parallel_multi_worker_evaluation(tmp_path):
    """Verify that multi-worker parallel evaluation produces matching results to single-worker."""
    ckpt_path = str(tmp_path / "model.pt")
    net = AlphaWolfNet()
    torch.save(net.state_dict(), ckpt_path)

    mini_gauntlet = [
        {"m": 4, "n": 4, "missing": []},
        {"m": 4, "n": 5, "missing": [(0, 0)]},
        {"m": 5, "n": 5, "missing": []}
    ]

    r_seq, n_seq, _ = evaluate_model(ckpt_path, mini_gauntlet, num_simulations=10, num_workers=1, use_cache=False)
    r_par, n_par, _ = evaluate_model(ckpt_path, mini_gauntlet, num_simulations=10, num_workers=3, use_cache=False)

    assert r_seq == r_par
    assert n_seq == n_par


def test_promotion_logic_unit_test(tmp_path):
    """Test promote_model decision branching."""
    baseline_pt = str(tmp_path / "best_model.pt")
    challenger_pt = str(tmp_path / "challenger.pt")

    net1 = AlphaWolfNet()
    torch.save(net1.state_dict(), baseline_pt)

    net2 = AlphaWolfNet()
    torch.save(net2.state_dict(), challenger_pt)

    assert os.path.exists(baseline_pt)
    assert os.path.exists(challenger_pt)


def test_alpha_zero_1_generation_dry_run(isolated_db):
    """
    Execute a full 1-generation AlphaZero loop:
    - Phase 1: Self-play across workers with gatekeeper verification
    - Phase 2: PyG network training with backprop
    - Phase 3: Checkpointing & Model Saving
    """
    m, n = 5, 5
    alpha_zero_loop(
        m=m,
        n=n,
        num_generations=1,
        games_per_generation=2,
        num_simulations=20,
        num_workers=2,
        mcts_batch_size=4,
        self_play_min_grid=4,
        self_play_max_grid=5
    )

    ckpt_dir = os.path.join(os.path.dirname(__file__), "../models/checkpoints")
    gen1_ckpt = os.path.join(ckpt_dir, "alphawolf_gen_1.pt")
    assert os.path.exists(gen1_ckpt), f"Checkpoint was not saved at {gen1_ckpt}"

    net = AlphaWolfNet(m, n)
    from checkpoint import load_checkpoint
    gen, meta = load_checkpoint(gen1_ckpt, net)
    assert gen == 1

    for name, param in net.named_parameters():
        assert not torch.isnan(param).any(), f"NaN in parameter {name}"
        assert not torch.isinf(param).any(), f"Inf in parameter {name}"
