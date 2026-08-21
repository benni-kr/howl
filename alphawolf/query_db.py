"""
HOWL & AlphaWolf Database Inspection Utility
Provides a clean terminal summary of best-known grid ranks, 2D matrix view, and solver standings.
"""

import os
import sys
import sqlite3
from collections import Counter

_ALPHAWOLF_DIR = os.path.dirname(os.path.abspath(__file__))
_CORE_DIR = os.path.abspath(os.path.join(_ALPHAWOLF_DIR, "../core_engine"))

for p in [_ALPHAWOLF_DIR, _CORE_DIR]:
    if p not in sys.path:
        sys.path.insert(0, p)

from db.tablebase import get_db_path


def print_header(title: str, width: int = 80):
    print("\n" + "═" * width)
    print(f" {title.center(width - 2)}")
    print("═" * width)


def print_section(title: str, width: int = 80):
    print(f"\n=== {title} " + "=" * max(0, width - len(title) - 5) + "\n")


def run_query():
    db_path = get_db_path()
    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 1. Fetch grid solutions (including all solvers tied for the best rank)
    cursor.execute("""
        SELECT g.m, g.n, g.rank AS best_rank, g.solver_name
        FROM grid_solutions g
        JOIN (
            SELECT m, n, MIN(rank) AS min_rank
            FROM grid_solutions
            GROUP BY m, n
        ) best ON g.m = best.m AND g.n = best.n AND g.rank = best.min_rank
        ORDER BY g.m * g.n ASC, g.m ASC, g.n ASC
    """)
    solutions_raw = cursor.fetchall()

    # 2. Fetch subgraph dictionary stats
    cursor.execute("SELECT COUNT(*), COUNT(DISTINCT hash) FROM subgraph_dictionary")
    subgraph_counts = cursor.fetchone()
    total_subgraphs = subgraph_counts[0] if subgraph_counts else 0

    cursor.execute("SELECT COUNT(*) FROM subgraph_dictionary WHERE is_optimal = 1")
    optimal_subgraphs = cursor.fetchone()[0]

    conn.close()

    if not solutions_raw:
        print("Database is currently empty.")
        return

    # Map (m, n) -> rank, set(solvers)
    grid_map = {}
    solver_counts = Counter()
    for m, n, rank, solver in solutions_raw:
        if (m, n) not in grid_map:
            grid_map[(m, n)] = (rank, [solver])
        else:
            if solver not in grid_map[(m, n)][1]:
                grid_map[(m, n)][1].append(solver)
        solver_counts[solver] += 1

    total_grids = len(grid_map)
    solutions = [(m, n, rank, ", ".join(solvers)) for (m, n), (rank, solvers) in grid_map.items()]

    # ------------------------------------------------------------------------
    # HEADER & OVERVIEW
    # ------------------------------------------------------------------------
    print_header("HOWL Leaderboard & Tablebase Summary")
    print(f"  • Database Path      : {os.path.relpath(db_path, os.getcwd()) if os.path.isabs(db_path) else db_path}")
    print(f"  • Unique Grids Solved: {total_grids:,}")
    print(f"  • Tablebase Shapes   : {total_subgraphs:,} ({optimal_subgraphs:,} verified optimal)")
    print(f"  • Total Solvers      : {len(solver_counts):,}")

    # ------------------------------------------------------------------------
    # 10x10 MATRIX VIEW
    # ------------------------------------------------------------------------
    max_dim = 10
    print_section(f"{max_dim}×{max_dim} Grid Best-Rank Matrix")
    
    # Header row (columns n = 1..10)
    col_headers = "".join(f"{n:>4}" for n in range(1, max_dim + 1))
    print(f"   m\\n {col_headers}")
    print("   ────" + "────" * max_dim)

    for m in range(1, max_dim + 1):
        row_str = f"  {m:>2}  │"
        for n in range(1, max_dim + 1):
            entry = grid_map.get((m, n)) or grid_map.get((n, m))
            if entry:
                rank_str = f"{entry[0]:>4}"
            else:
                rank_str = "   ·"
            row_str += rank_str
        print(row_str)

    # ------------------------------------------------------------------------
    # SOLVER STANDINGS
    # ------------------------------------------------------------------------
    print_section("Top Solvers & Record Holders")
    print(f"  {'#':<3} {'Solver Name':<22} {'Records':>8}   {'Share':>7}")
    print("  " + "─" * 3 + " " + "─" * 22 + " " + "─" * 8 + "   " + "─" * 7)

    medals = ["🥇", "🥈", "🥉"]
    for idx, (solver, count) in enumerate(solver_counts.most_common(10), 1):
        share = (count / total_grids) * 100
        prefix = medals[idx - 1] if idx <= 3 else f"{idx:>3}."
        print(f"  {prefix:<3} {solver:<22} {count:>8}   {share:>6.1f}%")

    # ------------------------------------------------------------------------
    # ALPHAWOLF DISCOVERY HIGHLIGHTS (Sorted largest to smallest)
    # ------------------------------------------------------------------------
    alphawolf_records = []
    for (m, n), (rank, solvers) in grid_map.items():
        matched = [s for s in solvers if "alphawolf" in s.lower()]
        if matched:
            alphawolf_records.append((m, n, rank, ", ".join(matched)))
    alphawolf_records.sort(key=lambda x: (x[0] * x[1], max(x[0], x[1])), reverse=True)

    print_section(f"AlphaWolf Records Held ({len(alphawolf_records)} Grids — Largest First)")
    if alphawolf_records:
        print(f"  AlphaWolf agents hold the best-known rank on {len(alphawolf_records)} boards:")
        formatted_grids = [f"{m}×{n} (r={rank} by {solver})" for m, n, rank, solver in alphawolf_records]
        
        # Display in chunks of 3 per line for clean readability
        for i in range(0, len(formatted_grids), 3):
            chunk = formatted_grids[i:i+3]
            print("    • " + "   ".join(f"{item:<24}" for item in chunk))
    else:
        print("  No records currently held by AlphaWolf in this database.")


if __name__ == "__main__":
    run_query()
