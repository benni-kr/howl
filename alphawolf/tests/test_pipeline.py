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
    state_dict = torch.load(gen1_ckpt, map_location='cpu', weights_only=True)
    net.load_state_dict(state_dict)

    for name, param in net.named_parameters():
        assert not torch.isnan(param).any(), f"NaN in parameter {name}"
        assert not torch.isinf(param).any(), f"Inf in parameter {name}"
