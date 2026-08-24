"""
Unit Tests for Curriculum Manager.
"""

import pytest
from curriculum import CurriculumManager


def test_uniform_curriculum():
    """Verify uniform mode samples across the full range."""
    cm = CurriculumManager(mode="uniform", min_grid=4, max_grid=9)
    samples = cm.sample_games(50, current_generation=1)
    assert len(samples) == 50
    for m, n in samples:
        assert 4 <= m <= 9
        assert 4 <= n <= 9


def test_linear_curriculum_expansion():
    """Verify linear mode expands the maximum sampled grid size progressively."""
    cm = CurriculumManager(mode="linear", min_grid=4, max_grid=10, total_generations=10)

    # Generation 1: max size should be 4
    gen1_samples = cm.sample_games(20, current_generation=1)
    for m, n in gen1_samples:
        assert max(m, n) == 4

    # Generation 10: max size can reach 10
    gen10_samples = cm.sample_games(50, current_generation=10)
    max_reached = max(max(m, n) for m, n in gen10_samples)
    assert max_reached >= 8


def test_hybrid_curriculum_sampling_distribution():
    """Verify hybrid mode samples 70% frontier and 30% foundational replay."""
    cm = CurriculumManager(
        mode="hybrid",
        min_grid=4,
        max_grid=9,
        stages=[
            {"max_size": 7, "fraction": 0.5, "name": "Stage 1 (Up to 7x7)"},
            {"max_size": 9, "fraction": 0.5, "name": "Stage 2 (Up to 9x9)"},
        ],
        frontier_ratio=0.70
    )

    samples = cm.sample_games(200, current_generation=1)
    assert len(samples) == 200

    frontier_count = sum(1 for m, n in samples if max(m, n) >= 6)
    foundation_count = sum(1 for m, n in samples if max(m, n) <= 5)

    # Allow probabilistic variance around 70/30 (e.g. between 60% and 80%)
    assert 110 <= frontier_count <= 170, f"Frontier count {frontier_count} out of expected range"
    assert 30 <= foundation_count <= 90, f"Foundation count {foundation_count} out of expected range"


def test_fast_track_mastery_advancement():
    """Verify fast-track stage promotion when success rate >= 80%."""
    cm = CurriculumManager(
        mode="hybrid",
        min_grid=4,
        max_grid=9,
        stages=[
            {"max_size": 5, "fraction": 0.5, "max_gens": 10},
            {"max_size": 7, "fraction": 0.5, "max_gens": 10},
        ],
        success_threshold=0.80
    )

    assert cm.current_stage_idx == 0
    assert cm.current_max_size == 5

    # Simulate generation 1 results with 90% success rate on 5x5 boards (e.g. rank 9 meets target)
    results = [(5, 5, 9)] * 9 + [(5, 5, 20)] * 1  # 9 met target, 1 failed
    summary = cm.record_generation_results(generation=1, results=results)

    assert summary["success_rate"] == 0.90
    assert summary["advanced"] is True
    assert "Mastery achieved" in summary["advance_reason"]
    assert cm.current_stage_idx == 1
    assert cm.current_max_size == 7


def test_stage_timeout_advancement():
    """Verify stage timeout fallback advances when generation budget expires."""
    cm = CurriculumManager(
        mode="hybrid",
        min_grid=4,
        max_grid=9,
        stages=[
            {"max_size": 5, "fraction": 0.5, "max_gens": 2},
            {"max_size": 7, "fraction": 0.5, "max_gens": 2},
        ],
        success_threshold=0.80
    )

    # Gen 1: poor results (0% success) -> should NOT advance
    r1 = cm.record_generation_results(1, [(5, 5, 25)] * 5)
    assert r1["advanced"] is False
    assert cm.current_stage_idx == 0

    # Gen 2: poor results again -> budget exhausted (2/2) -> advances on timeout
    r2 = cm.record_generation_results(2, [(5, 5, 25)] * 5)
    assert r2["advanced"] is True
    assert "budget reached" in r2["advance_reason"]
    assert cm.current_stage_idx == 1
    assert cm.current_max_size == 7


def test_curriculum_state_dict_serialization():
    """Verify curriculum state serialization and resumption."""
    cm1 = CurriculumManager(mode="hybrid", min_grid=4, max_grid=9)
    cm1.current_stage_idx = 1
    cm1.stage_generations_spent = 3
    cm1.history = [{"gen": 1, "success_rate": 0.85}]

    state = cm1.state_dict()

    cm2 = CurriculumManager(mode="hybrid", min_grid=4, max_grid=9)
    cm2.load_state_dict(state)

    assert cm2.current_stage_idx == 1
    assert cm2.stage_generations_spent == 3
    assert len(cm2.history) == 1
