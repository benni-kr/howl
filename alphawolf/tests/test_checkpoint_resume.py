"""
Unit Tests for Model Checkpointing and Training Resume Functionality.
"""

import os
import torch
import torch.optim as optim
import pytest

from models.net import AlphaWolfNet
from checkpoint import (
    find_latest_checkpoint,
    resolve_checkpoint_path,
    load_checkpoint,
    save_checkpoint,
)
from train import alpha_zero_loop


def test_save_and_load_full_checkpoint(tmp_path):
    """Verify that save_checkpoint and load_checkpoint preserve model weights, optimizer, and scheduler states."""
    ckpt_path = str(tmp_path / "alphawolf_gen_5.pt")

    net1 = AlphaWolfNet()
    opt1 = optim.Adam(net1.parameters(), lr=1e-3)
    sch1 = optim.lr_scheduler.CosineAnnealingLR(opt1, T_max=50, eta_min=1e-5)

    # Perform a dummy optimizer and scheduler step
    dummy_x = torch.randn(1, 9, 10, 10)
    p, v = net1(dummy_x)
    loss = p.sum() + v.sum()
    loss.backward()
    opt1.step()
    sch1.step()

    save_checkpoint(
        ckpt_path,
        net1,
        optimizer=opt1,
        scheduler=sch1,
        generation=5,
        solver_name="alphawolf_test",
        metrics={"policy_loss": 1.23, "value_loss": 4.56}
    )

    assert os.path.exists(ckpt_path)

    # Load into fresh net, optimizer, scheduler
    net2 = AlphaWolfNet()
    opt2 = optim.Adam(net2.parameters(), lr=1e-3)
    sch2 = optim.lr_scheduler.CosineAnnealingLR(opt2, T_max=50, eta_min=1e-5)

    last_gen, meta = load_checkpoint(ckpt_path, net2, optimizer=opt2, scheduler=sch2)

    assert last_gen == 5
    assert meta["solver_name"] == "alphawolf_test"
    assert meta["metrics"]["policy_loss"] == 1.23

    # Weights must match bit-for-bit
    for p1, p2 in zip(net1.parameters(), net2.parameters()):
        assert torch.equal(p1, p2)


def test_load_legacy_raw_state_dict(tmp_path):
    """Verify backward compatibility when loading a raw OrderedDict state_dict."""
    ckpt_path = str(tmp_path / "alphawolf_gen_12.pt")
    net1 = AlphaWolfNet()
    torch.save(net1.state_dict(), ckpt_path)

    net2 = AlphaWolfNet()
    gen, meta = load_checkpoint(ckpt_path, net2)

    assert gen == 12
    for p1, p2 in zip(net1.parameters(), net2.parameters()):
        assert torch.equal(p1, p2)


def test_find_latest_checkpoint(tmp_path):
    """Verify that find_latest_checkpoint correctly identifies the highest generation."""
    assert find_latest_checkpoint(str(tmp_path)) is None

    # Create fake checkpoint files
    for g in [2, 10, 25, 7]:
        f = tmp_path / f"alphawolf_gen_{g}.pt"
        f.write_text("fake")

    latest = find_latest_checkpoint(str(tmp_path))
    assert latest == str(tmp_path / "alphawolf_gen_25.pt")


def test_resolve_checkpoint_path(tmp_path):
    """Verify resolution of aliases: None, 'latest', 'best', explicit path."""
    assert resolve_checkpoint_path(None, str(tmp_path)) is None
    assert resolve_checkpoint_path(False, str(tmp_path)) is None

    best = tmp_path / "best_model.pt"
    best.write_text("fake")
    assert resolve_checkpoint_path("best", str(tmp_path)) == str(best)

    gen3 = tmp_path / "alphawolf_gen_3.pt"
    gen3.write_text("fake")
    assert resolve_checkpoint_path("latest", str(tmp_path)) == str(gen3)
    assert resolve_checkpoint_path(str(gen3), str(tmp_path)) == str(gen3)


def test_alpha_zero_loop_resume_execution(tmp_path, isolated_db):
    """
    Test end-to-end resume:
    1. Run Generation 1 -> saves alphawolf_gen_1.pt
    2. Resume from alphawolf_gen_1.pt with total_generations=2 -> runs Generation 2
    """
    ckpt_dir = tmp_path / "checkpoints"
    ckpt_dir.mkdir(parents=True)

    net = AlphaWolfNet(5, 5)
    opt = optim.Adam(net.parameters(), lr=1e-3)
    sch = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=2)

    gen1_ckpt = str(ckpt_dir / "alphawolf_gen_1.pt")
    save_checkpoint(gen1_ckpt, net, optimizer=opt, scheduler=sch, generation=1)

    # Resume training using alpha_zero_loop from gen 1 to 2
    alpha_zero_loop(
        m=5,
        n=5,
        num_generations=2,
        games_per_generation=1,
        num_simulations=10,
        num_workers=1,
        mcts_batch_size=2,
        self_play_min_grid=4,
        self_play_max_grid=5,
        resume_from=gen1_ckpt,
    )


def test_save_and_load_replay_buffer(tmp_path):
    """Verify save_replay_buffer and load_replay_buffer persist and restore PyG Data objects on CPU."""
    from torch_geometric.data import Data
    from checkpoint import save_replay_buffer, load_replay_buffer

    buf_path = str(tmp_path / "replay_buffer.pt")
    
    # Create sample Data items
    sample_buffer = []
    for i in range(10):
        d = Data(
            x=torch.randn(4, 8),
            edge_index=torch.tensor([[0, 1], [1, 0]], dtype=torch.long),
            flat_indices=torch.tensor([0, 1, 2, 3], dtype=torch.long),
            pi=torch.zeros(100),
            v=torch.tensor([float(i)])
        )
        sample_buffer.append(d)

    saved_path = save_replay_buffer(sample_buffer, buf_path, max_samples=8)
    assert os.path.exists(saved_path)

    # Restored buffer should respect max_samples cap (last 8)
    restored = load_replay_buffer(buf_path)
    assert len(restored) == 8
    assert restored[-1].v.item() == 9.0

    for item in restored:
        assert item.x.device.type == "cpu"
        assert item.edge_index.device.type == "cpu"
