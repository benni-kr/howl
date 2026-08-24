"""
Unit Tests for Mathematical Reference Bounds and Triangulated Targets.
"""

import pytest
from bounds import get_lower_bound, get_bisection_upper_bound, get_effective_target


def test_lower_bound_invariants():
    """Verify lower bound invariants across various grid shapes."""
    assert get_lower_bound(1, 1) == 1
    assert get_lower_bound(1, 4) == 3   # 1D path of 4 nodes: rank 3
    assert get_lower_bound(2, 2) == 3   # 2x2 cycle: rank 3
    assert get_lower_bound(3, 3) == 5
    assert get_lower_bound(4, 4) == 7
    assert get_lower_bound(5, 5) == 8
    assert get_lower_bound(6, 6) == 8
    assert get_lower_bound(7, 7) == 9
    assert get_lower_bound(8, 8) == 11
    assert get_lower_bound(9, 9) == 13
    assert get_lower_bound(10, 10) == 14

    # Symmetry invariant: lower_bound(m, n) == lower_bound(n, m)
    for m in range(1, 15):
        for n in range(1, 15):
            assert get_lower_bound(m, n) == get_lower_bound(n, m)


def test_bisection_upper_bound_invariants():
    """Verify recursive balanced bisection upper bounds."""
    assert get_bisection_upper_bound(1, 1) == 1
    assert get_bisection_upper_bound(2, 2) == 3
    assert get_bisection_upper_bound(3, 3) == 5
    assert get_bisection_upper_bound(4, 4) == 9
    assert get_bisection_upper_bound(5, 5) == 10

    # Invariant: lower_bound(m, n) <= bisection_upper_bound(m, n) for all grids
    for m in range(1, 20):
        for n in range(1, 20):
            lb = get_lower_bound(m, n)
            ub = get_bisection_upper_bound(m, n)
            assert lb <= ub, f"Violated invariant at {m}x{n}: LB {lb} > UB {ub}"


def test_effective_target_triangulation():
    """Test triangulation against missing DB records, optimal records, and suboptimal records."""
    # Case 1: No DB record -> falls back to bisection bound
    t1 = get_effective_target(5, 5, db_record=None)
    assert t1["target_rank"] == get_bisection_upper_bound(5, 5)
    assert t1["source"] == "bisection_fallback"

    # Case 2: Good DB record (e.g. 10 on 5x5, better than bisection 11)
    t2 = get_effective_target(5, 5, db_record=10)
    assert t2["target_rank"] == 10
    assert t2["source"] == "db_record"

    # Case 3: Bad DB record (e.g. 25 on 5x5, worse than bisection 11)
    t3 = get_effective_target(5, 5, db_record=25)
    assert t3["target_rank"] == get_bisection_upper_bound(5, 5)
    assert t3["source"] == "bisection_cap"

    # Case 4: Impossible DB record below lower bound (should clamp to lower bound)
    t4 = get_effective_target(5, 5, db_record=3)
    assert t4["target_rank"] == get_lower_bound(5, 5)
