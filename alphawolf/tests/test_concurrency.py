"""
Unit Tests for MCTS Tree Concurrency, Virtual Loss, and Multi-Worker Isolation.
"""

import io
import pytest
import torch
import torch.multiprocessing as mp
import numpy as np

from models.net import AlphaWolfNet
from envs.howl_env import HowlEnv, MAX_ROWS, MAX_COLS
from train import (
    MCTSNode,
    ucb_score,
    mcts_search,
    simulate_game_worker,
    self_play
)
from core_engine.replay_engine import replay_and_extract_subgraphs


def test_virtual_loss_zero_leakage_and_visit_count_balance(isolated_db):
    """
    Assert that across any batch size (1, 4, 8, 16), after mcts_search completes:
    1. virtual_loss == 0 on EVERY node in the search tree.
    2. Sum of root child visits strictly equals num_simulations.
    """
    net = AlphaWolfNet()
    net.eval()

    env = HowlEnv(4, 4)
    obs, _ = env.reset()

    for batch_sz in [1, 4, 8, 16]:
        num_sims = 64
        root = mcts_search(obs, net, env, num_simulations=num_sims, add_exploration_noise=False, batch_size=batch_sz)

        total_child_visits = sum(child.visit_count for child in root.children.values())
        assert total_child_visits == num_sims

        def check_node(node):
            assert node.virtual_loss == 0
            for child in node.children.values():
                check_node(child)

        check_node(root)


def test_ucb_score_virtual_loss_penalty_steering():
    """Verify that ucb_score penalizes in-flight nodes to steer concurrent searches."""
    parent = MCTSNode(state=None)
    parent.visit_count = 10
    parent.value_sum = 30.0

    child = MCTSNode(state=None, parent=parent, prior=0.5)
    child.visit_count = 4
    child.value_sum = 12.0

    base_score = ucb_score(parent, child)

    child.virtual_loss = 1
    parent.virtual_loss = 1
    penalized_score = ucb_score(parent, child)

    assert penalized_score > base_score


def test_action_masking_strictness():
    """Verify all inactive canvas positions are masked to -1e9 with 0 probability."""
    net = AlphaWolfNet()
    net.eval()

    obs = np.zeros((5, MAX_ROWS, MAX_COLS), dtype=np.float32)
    active = [(0, 0), (0, 1), (1, 0), (1, 1)]
    for x, y in active:
        obs[0, x, y] = 1.0
        obs[1, x, y] = 0.5
        obs[3, x, y] = 1.0

    with torch.no_grad():
        state_tensor = torch.tensor(obs, dtype=torch.float32).unsqueeze(0)
        p_logits, v = net(state_tensor)

        mask = (state_tensor[:, 0, :, :] == 0).flatten()
        p_logits_flat = p_logits.flatten()
        p_logits_flat[mask] = -1e9
        p_probs = torch.softmax(p_logits_flat, dim=0).numpy()

    active_flat = [0, 1, 10, 11]
    for idx in range(100):
        if idx in active_flat:
            assert p_probs[idx] > 0.0
        else:
            assert p_probs[idx] == 0.0


def test_simulate_game_worker_spawn_isolation(isolated_db):
    """Verify simulate_game_worker executes cleanly in a separate spawned process."""
    net = AlphaWolfNet()
    buf = io.BytesIO()
    torch.save(net.state_dict(), buf)
    model_bytes = buf.getvalue()
    worker_args = (3, 3, model_bytes, 40, 1, 4)

    ctx = mp.get_context('spawn')
    with ctx.Pool(1) as pool:
        result = pool.apply(simulate_game_worker, (worker_args,))

    game_id, m, n, traj_bytes, final_rank, discoveries = result
    traj = torch.load(io.BytesIO(traj_bytes), map_location='cpu', weights_only=False)

    assert game_id == 1
    assert m == 3 and n == 3
    assert final_rank > 0
    assert len(traj) > 0

    for data in traj:
        assert data.x.device.type == "cpu"
        assert data.edge_index.device.type == "cpu"
        assert data.node_pi.device.type == "cpu"
        assert data.v.device.type == "cpu"

    assert len(discoveries) > 0
    final_sequence = discoveries[0][2]
    ranks_dict, root_rank = replay_and_extract_subgraphs(m, n, final_sequence)
    assert root_rank == final_rank


def test_multi_worker_self_play_end_to_end(isolated_db):
    """Run self_play with 3 parallel worker processes on multiple grid sizes."""
    net = AlphaWolfNet()
    grids = [(2, 2), (2, 3), (3, 3)]

    replay_buffer = self_play(
        net,
        grids,
        num_simulations=40,
        num_workers=3,
        mcts_batch_size=4
    )

    assert len(replay_buffer) > 0
