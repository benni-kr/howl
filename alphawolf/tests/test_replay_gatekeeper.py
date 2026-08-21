"""
Unit Tests for the Replay Engine Validation Gatekeeper.
"""

import sqlite3
import pytest

import db.tablebase as tb
from models.net import AlphaWolfNet
from envs.howl_env import HowlEnv
from train import play_episode
from core_engine.replay_engine import replay_and_extract_subgraphs


def test_gatekeeper_accepts_valid_solution(isolated_db):
    """A mathematically valid 1x3 cut sequence must be validated, canonicalized (to 3x1), and saved."""
    valid_seq_1x3 = [
        {"t": "c", "v": [[0, 1]]},
        {"t": "i", "v": [[0, 2]]},
        {"t": "c", "v": [[0, 0]]}
    ]
    success = tb.validate_and_upsert_solution(1, 3, 2, valid_seq_1x3, solver_name="alphawolf")
    assert success is True

    conn = sqlite3.connect(isolated_db)
    cursor = conn.cursor()
    cursor.execute("SELECT m, n, rank, solver_name FROM grid_solutions WHERE m = 3 AND n = 1")
    row = cursor.fetchone()
    assert row == (3, 1, 2, "alphawolf")

    cursor.execute("SELECT COUNT(*) FROM subgraph_dictionary")
    count = cursor.fetchone()[0]
    assert count > 0
    conn.close()


def test_gatekeeper_rejects_rank_mismatch(isolated_db):
    """If an agent falsely claims a lower rank than the cut sequence achieves, reject immediately."""
    valid_seq_2x2 = [
        {"t": "c", "v": [[0, 0]]},
        {"t": "c", "v": [[1, 1]]},
        {"t": "i", "v": [[1, 0]]},
        {"t": "c", "v": [[0, 1]]}
    ]
    # Sequence achieves rank 3, but falsely claims rank 2
    success = tb.validate_and_upsert_solution(2, 2, 2, valid_seq_2x2, solver_name="rogue_agent")
    assert success is False

    conn = sqlite3.connect(isolated_db)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM grid_solutions")
    assert cursor.fetchone()[0] == 0
    cursor.execute("SELECT COUNT(*) FROM subgraph_dictionary")
    assert cursor.fetchone()[0] == 0
    conn.close()


def test_gatekeeper_rejects_corrupted_sequence(isolated_db):
    """If a sequence has invalid cut targets or doesn't solve the board, reject immediately."""
    corrupted_seq = [{"t": "c", "v": [[99, 99]]}]
    success = tb.validate_and_upsert_solution(3, 3, 4, corrupted_seq, solver_name="alphawolf")
    assert success is False

    incomplete_seq = [{"t": "c", "v": [[0, 0]]}]
    success2 = tb.validate_and_upsert_solution(3, 3, 4, incomplete_seq, solver_name="alphawolf")
    assert success2 is False

    conn = sqlite3.connect(isolated_db)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM grid_solutions")
    assert cursor.fetchone()[0] == 0
    conn.close()


def test_gatekeeper_end_to_end_selfplay_integration(isolated_db):
    """
    Simulate self-play episodes across multiple grid sizes and verify that
    100% of generated discoveries pass the replay validation gatekeeper.
    """
    net = AlphaWolfNet()
    net.eval()

    for m, n in [(2, 2), (2, 3), (3, 3)]:
        env = HowlEnv(m, n)
        obs, _ = env.reset()
        traj, final_rank, discoveries = play_episode(
            net, env, obs, num_simulations=40, add_exploration_noise=False, batch_size=4
        )
        assert len(discoveries) > 0
        final_sequence = discoveries[0][2]

        saved = tb.validate_and_upsert_solution(m, n, final_rank, final_sequence, solver_name="alphawolf")
        assert saved is True

    conn = sqlite3.connect(isolated_db)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM grid_solutions")
    assert cursor.fetchone()[0] == 3
    conn.close()
