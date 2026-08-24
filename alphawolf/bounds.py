"""
Mathematical Reference Bounds for HOWL Grid Graphs.

Provides analytical lower bounds, recursive balanced bisection upper bounds,
and triangulated reference targets for any grid size (m, n).
"""

from __future__ import annotations

import functools
import math


@functools.lru_cache(maxsize=1024)
def get_lower_bound(m: int, n: int) -> int:
    """
    Computes the strict analytical lower bound for an m x n grid graph.
    Matches the frontend MatrixView formula.
    """
    min_dim = min(m, n)
    max_dim = max(m, n)

    if min_dim <= 0:
        return 0

    # 1 x n Grids (Path graphs)
    if min_dim == 1:
        return math.floor(math.log2(max_dim)) + 1

    # 2 x n Grids (Ladder graphs)
    if min_dim == 2:
        if max_dim == 2:
            return 3
        return 2 + get_lower_bound(2, math.ceil((max_dim - 2) / 2))

    # 3 x n Grids
    if min_dim == 3:
        if max_dim == 2:
            return 4
        if max_dim == 3:
            return 5
        return 3 + get_lower_bound(3, math.ceil((max_dim - 3) / 2))

    # 4 x n Grids
    if min_dim == 4:
        if max_dim == 2:
            return 4
        if max_dim == 3:
            return 6
        if max_dim == 4:
            return 7
        if max_dim == 5:
            return 8
        return 4 + get_lower_bound(4, math.ceil((max_dim - 4) / 2))

    # General m x n Grids (min_dim >= 5)
    square_bound = math.ceil((5 / 3) * min_dim - (25 / 9))
    subgrid_bound = get_lower_bound(4, max_dim)

    return max(square_bound, subgrid_bound)


@functools.lru_cache(maxsize=1024)
def get_bisection_upper_bound(m: int, n: int) -> int:
    """
    Computes the recursive balanced bisection constructive upper bound.
    Bisects the larger dimension along the center line at each step.
    """
    if m <= 0 or n <= 0:
        return 0
    if m == 1 and n == 1:
        return 1
    if min(m, n) == 1:
        return math.floor(math.log2(max(m, n))) + 1

    # Exact small grid base cases
    min_d, max_d = min(m, n), max(m, n)
    if min_d == 2 and max_d == 2:
        return 3
    if min_d == 2 and max_d == 3:
        return 4
    if min_d == 3 and max_d == 3:
        return 5

    if m >= n:
        # Cut horizontally through middle separator (n vertices)
        f1_m = (m - 1) // 2
        f2_m = m - 1 - f1_m
        sub_rank = max(get_bisection_upper_bound(f1_m, n), get_bisection_upper_bound(f2_m, n))
        return n + sub_rank
    else:
        # Cut vertically through middle separator (m vertices)
        f1_n = (n - 1) // 2
        f2_n = n - 1 - f1_n
        sub_rank = max(get_bisection_upper_bound(m, f1_n), get_bisection_upper_bound(m, f2_n))
        return m + sub_rank


def get_effective_target(m: int, n: int, db_record: int | float | None = None) -> dict:
    """
    Triangulates the effective benchmark target rank for an m x n grid.

    R_target = min(R_bisection(m, n), R_db(m, n) if present)
    Clamped to be >= get_lower_bound(m, n).
    """
    lb = get_lower_bound(m, n)
    ub_bisect = get_bisection_upper_bound(m, n)

    if db_record is not None and db_record > 0:
        db_int = int(db_record)
        if db_int <= ub_bisect:
            target = db_int
            source = "db_record"
        else:
            target = ub_bisect
            source = "bisection_cap"  # DB record was worse than standard bisection
    else:
        target = ub_bisect
        source = "bisection_fallback"

    target = max(target, lb)

    return {
        "m": m,
        "n": n,
        "lower_bound": lb,
        "bisection_bound": ub_bisect,
        "db_record": db_record,
        "target_rank": target,
        "source": source,
    }
