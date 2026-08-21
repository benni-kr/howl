"""
Database Migration: Canonicalize Grid Solutions (Enforce m >= n)
Consolidates any (m < n) grid solutions into their canonical (m >= n) orientation.
Transposes cut sequence coordinates [x, y] -> [y, x] and preserves the best rank per solver.
"""

import json
import os
import sys
import sqlite3

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ROOT_DIR = os.path.dirname(_BACKEND_DIR)
_CORE_DIR = os.path.join(_ROOT_DIR, "core_engine")

for p in [_BACKEND_DIR, _ROOT_DIR, _CORE_DIR]:
    if p not in sys.path:
        sys.path.insert(0, p)

from core_engine.replay_engine import canonicalize_grid_solution


def migrate_database(db_path: str = None):
    if db_path is None:
        db_path = os.path.join(_BACKEND_DIR, "howl.db")

    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}")
        return

    print(f"Connecting to database: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Fetch all rows where m < n
    cursor.execute("SELECT id, m, n, rank, solver_name, cut_sequence, created_at FROM grid_solutions WHERE m < n")
    non_canonical_rows = cursor.fetchall()
    print(f"Found {len(non_canonical_rows)} rows where m < n to canonicalize.")

    migrated_count = 0
    consolidated_count = 0

    for row_id, m, n, rank, solver, seq_json, created_at in non_canonical_rows:
        seq = json.loads(seq_json) if seq_json else []
        canon_m, canon_n, canon_seq = canonicalize_grid_solution(m, n, seq)
        canon_seq_json = json.dumps(canon_seq)

        # Check if a canonical entry (canon_m, canon_n, solver) already exists
        cursor.execute(
            "SELECT id, rank, cut_sequence, created_at FROM grid_solutions WHERE m = ? AND n = ? AND solver_name = ?",
            (canon_m, canon_n, solver)
        )
        existing = cursor.fetchone()

        if existing is None:
            # Update this row in-place to canonical dimensions and transposed sequence
            cursor.execute(
                "UPDATE grid_solutions SET m = ?, n = ?, cut_sequence = ? WHERE id = ?",
                (canon_m, canon_n, canon_seq_json, row_id)
            )
            migrated_count += 1
        else:
            exist_id, exist_rank, exist_seq, exist_created_at = existing
            # If the non-canonical row had a better rank, update the canonical row with its sequence
            if rank < exist_rank:
                cursor.execute(
                    "UPDATE grid_solutions SET rank = ?, cut_sequence = ?, created_at = ? WHERE id = ?",
                    (rank, canon_seq_json, created_at, exist_id)
                )
            # Delete the redundant non-canonical row
            cursor.execute("DELETE FROM grid_solutions WHERE id = ?", (row_id,))
            consolidated_count += 1

    conn.commit()

    # Verification
    cursor.execute("SELECT COUNT(*) FROM grid_solutions WHERE m < n")
    remaining_non_canonical = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM grid_solutions")
    total_remaining = cursor.fetchone()[0]

    print("\n--- Migration Complete ---")
    print(f"  • Updated in-place: {migrated_count}")
    print(f"  • Consolidated/Deleted redundant: {consolidated_count}")
    print(f"  • Remaining m < n rows: {remaining_non_canonical}")
    print(f"  • Total valid canonical grid solutions: {total_remaining}")

    conn.close()


if __name__ == "__main__":
    db_file = sys.argv[1] if len(sys.argv) > 1 else None
    migrate_database(db_file)
