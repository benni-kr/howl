"""
HOWL & AlphaWolf Database Inspection Utility
Provides a clean terminal summary of best-known grid ranks, 2D matrix view, and solver standings.
"""

import os
import sys
import sqlite3
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
from db.tablebase import get_db_path


def print_header(title: str, width: int = 70):
    print("\n" + "═" * width)
    print(f" {title.center(width - 2)}")
    print("═" * width)


def print_section(title: str, width: int = 70):
    print(f"\n── {title} " + "─" * max(0, width - len(title) - 4))


def run_query():
    db_path = get_db_path()
    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 1. Fetch grid solutions
    cursor.execute("""
        SELECT m, n, MIN(rank) AS best_rank, solver_name
        FROM grid_solutions
        GROUP BY m, n
        ORDER BY m * n ASC, m ASC, n ASC
    """)
    solutions = cursor.fetchall()

    # 2. Fetch subgraph dictionary stats
    cursor.execute("SELECT COUNT(*), COUNT(DISTINCT hash) FROM subgraph_dictionary")
    subgraph_counts = cursor.fetchone()
    total_subgraphs = subgraph_counts[0] if subgraph_counts else 0

    cursor.execute("SELECT COUNT(*) FROM subgraph_dictionary WHERE is_optimal = 1")
    optimal_subgraphs = cursor.fetchone()[0]

    conn.close()

    if not solutions:
        print("Database is currently empty.")
        return

    # Map (m, n) -> (rank, solver)
    grid_map = {(m, n): (rank, solver) for m, n, rank, solver in solutions}
    solver_counts = Counter(solver for _, _, _, solver in solutions)
    total_grids = len(solutions)

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
    print("   ───" + "────" * max_dim)

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
        prefix = medals[idx - 1] if idx <= 3 else f"{idx:>2}."
        print(f"  {prefix:<3} {solver:<22} {count:>8}   {share:>6.1f}%")

    # ------------------------------------------------------------------------
    # ALPHAWOLF DISCOVERY HIGHLIGHTS
    # ------------------------------------------------------------------------
    alphawolf_records = [
        (m, n, rank) for (m, n), (rank, solver) in grid_map.items()
        if solver.lower() == "alphawolf"
    ]
    alphawolf_records.sort(key=lambda x: (x[0] * x[1], x[0], x[1]))

    print_section(f"AlphaWolf Standings ({len(alphawolf_records)} Records Held)")
    if alphawolf_records:
        formatted_grids = [f"{m}×{n} (r={rank})" for m, n, rank in alphawolf_records[:12]]
        print(f"  AlphaWolf holds {len(alphawolf_records)} best-known scores across the database.")
        print(f"  Notable grid records: {', '.join(formatted_grids)}")
        if len(alphawolf_records) > 12:
            print(f"  ... and {len(alphawolf_records) - 12} additional grids.")
    else:
        print("  No records currently held by AlphaWolf in this database.")

    # ------------------------------------------------------------------------
    # TOP DENSITY / LARGE GRIDS
    # ------------------------------------------------------------------------
    large_grids = sorted(solutions, key=lambda x: x[0] * x[1], reverse=True)[:10]
    print_section("Largest Solved Grids (Top 10 by Area)")
    print(f"  {'Grid':<8} {'Vertices':>10}   {'Best Rank':>10}   {'Solver':<15}")
    print("  " + "─" * 8 + " " + "─" * 10 + "   " + "─" * 10 + "   " + "─" * 15)
    for m, n, rank, solver in large_grids:
        grid_str = f"{m}×{n}"
        print(f"  {grid_str:<8} {m * n:>10,}   {rank:>10}   {solver:<15}")

    print("\n" + "═" * 70 + "\n")


if __name__ == "__main__":
    run_query()
