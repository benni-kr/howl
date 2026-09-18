"""Database Sanitization Script: Eliminate Ghost Operations

This script cleans redundant 1x1 tablebase vaporize and duplicate ignore operations
from `backend/howl.db`:
- `grid_solutions.cut_sequence`
- `subgraph_dictionary.best_cut_sequence`

Safety and Mathematical Soundness:
1. Automatically creates a physical backup (e.g. `howl.db.bak`) before touching data.
2. For every grid solution, verifies mathematically via `replay_and_extract_subgraphs`
   that `clean_rank == original_rank`.
3. Ensures all database writes occur in an atomic transaction; rolls back on any error.

Usage:
  # Dry run (default, safe inspection):
  python backend/scripts/sanitize_ghost_ops.py --dry-run

  # Execute sanitization:
  python backend/scripts/sanitize_ghost_ops.py --execute
"""

import os
import sys
import json
import shutil
import sqlite3
import argparse
import logging

# Ensure repo root and core_engine are on path
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO_ROOT)
sys.path.insert(0, os.path.join(REPO_ROOT, "core_engine"))

from core_engine.replay_engine import replay_and_extract_subgraphs

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("sanitize_ghost_ops")


def is_ghost_action(action: dict) -> bool:
    """Check if an action is a 1x1 ghost operation (vaporize or duplicate ignore on <= 1 vertex)."""
    if not isinstance(action, dict):
        return False
    action_type = action.get("t", action.get("type"))
    vertices = action.get("v", action.get("vertices", []))
    if action_type in ("v", "vaporize", "i", "ignore") and len(vertices) <= 1:
        return True
    return False


def clean_sequence(sequence: list) -> tuple[list, int]:
    """Strip 1x1 ghost operations from a sequence. Returns (cleaned_sequence, ghosts_removed_count)."""
    if not sequence or not isinstance(sequence, list):
        return sequence, 0
    cleaned = [a for a in sequence if not is_ghost_action(a)]
    ghost_count = len(sequence) - len(cleaned)
    return cleaned, ghost_count


def backup_database(db_path: str, backup_path: str) -> None:
    """Create a physical backup of the SQLite database."""
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found at {db_path}")
    logger.info(f"Creating physical backup: {db_path} -> {backup_path}")
    shutil.copyfile(db_path, backup_path)
    db_size = os.path.getsize(db_path)
    bak_size = os.path.getsize(backup_path)
    logger.info(f"Backup created successfully (DB size: {db_size:,} bytes, Backup size: {bak_size:,} bytes).")


def sanitize_database(db_path: str, execute: bool = False, backup_path: str = None) -> None:
    if not os.path.exists(db_path):
        logger.error(f"Database not found: {db_path}")
        sys.exit(1)

    if execute:
        if backup_path is None:
            backup_path = f"{db_path}.bak"
        backup_database(db_path, backup_path)
    else:
        logger.info("DRY RUN MODE: No changes will be written to the database.")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # 1. Process grid_solutions
        logger.info("--- Auditing & Verifying `grid_solutions` ---")
        cursor.execute("SELECT id, m, n, rank, solver_name, cut_sequence FROM grid_solutions")
        grid_rows = cursor.fetchall()

        grid_updates = []
        total_grid_ghosts = 0
        grid_solutions_with_ghosts = 0

        for sol_id, m, n, orig_rank, solver_name, seq_str in grid_rows:
            try:
                seq = json.loads(seq_str)
            except Exception as e:
                logger.error(f"Failed to parse JSON for grid_solutions id={sol_id} ({m}x{n}): {e}")
                raise

            cleaned_seq, ghosts_removed = clean_sequence(seq)
            if ghosts_removed > 0:
                grid_solutions_with_ghosts += 1
                total_grid_ghosts += ghosts_removed

                # Mathematical verification: replay the cleaned sequence and verify rank
                _, clean_rank = replay_and_extract_subgraphs(m, n, cleaned_seq)
                if clean_rank != orig_rank:
                    error_msg = (
                        f"CRITICAL RANK MISMATCH: Solution id={sol_id} ({m}x{n}) by {solver_name}. "
                        f"Original rank={orig_rank}, Replayed clean rank={clean_rank}!"
                    )
                    logger.critical(error_msg)
                    raise ValueError(error_msg)

                grid_updates.append((json.dumps(cleaned_seq), sol_id))

        logger.info(
            f"`grid_solutions` scan complete: {len(grid_rows)} total solutions, "
            f"{grid_solutions_with_ghosts} contain ghost ops ({total_grid_ghosts} total ghost actions). "
            f"All {grid_solutions_with_ghosts} solutions verified with bit-exact mathematical rank preservation!"
        )

        # 2. Process subgraph_dictionary
        logger.info("--- Auditing `subgraph_dictionary` ---")
        cursor.execute("SELECT hash, best_cut_sequence FROM subgraph_dictionary WHERE best_cut_sequence IS NOT NULL")
        subgraph_rows = cursor.fetchall()

        subgraph_updates = []
        total_subgraph_ghosts = 0
        subgraphs_with_ghosts = 0

        for h, seq_str in subgraph_rows:
            try:
                seq = json.loads(seq_str)
            except Exception:
                continue

            cleaned_seq, ghosts_removed = clean_sequence(seq)
            if ghosts_removed > 0:
                subgraphs_with_ghosts += 1
                total_subgraph_ghosts += ghosts_removed
                subgraph_updates.append((json.dumps(cleaned_seq), h))

        logger.info(
            f"`subgraph_dictionary` scan complete: {len(subgraph_rows)} rows checked, "
            f"{subgraphs_with_ghosts} contain ghost ops ({total_subgraph_ghosts} total ghost actions)."
        )

        # 3. Apply updates if executing
        if execute:
            logger.info("Writing changes within atomic database transaction...")
            cursor.executemany(
                "UPDATE grid_solutions SET cut_sequence = ? WHERE id = ?",
                grid_updates
            )
            logger.info(f"Updated {len(grid_updates)} rows in `grid_solutions`.")

            cursor.executemany(
                "UPDATE subgraph_dictionary SET best_cut_sequence = ? WHERE hash = ?",
                subgraph_updates
            )
            logger.info(f"Updated {len(subgraph_updates)} rows in `subgraph_dictionary`.")

            conn.commit()
            logger.info("Transaction committed successfully.")

            # 4. Post-verification audit
            cursor.execute("SELECT cut_sequence FROM grid_solutions")
            post_grid_ghosts = sum(
                clean_sequence(json.loads(row[0]))[1]
                for row in cursor.fetchall()
            )
            cursor.execute("SELECT best_cut_sequence FROM subgraph_dictionary WHERE best_cut_sequence IS NOT NULL")
            post_sub_ghosts = sum(
                clean_sequence(json.loads(row[0]))[1]
                for row in cursor.fetchall()
            )

            assert post_grid_ghosts == 0, f"Remaining ghost ops in grid_solutions: {post_grid_ghosts}"
            assert post_sub_ghosts == 0, f"Remaining ghost ops in subgraph_dictionary: {post_sub_ghosts}"
            logger.info("POST-VERIFICATION PASSED: 0 ghost operations remain across all tables in howl.db.")
        else:
            logger.info("Dry run complete. Use --execute to apply these verified updates.")

    except Exception as exc:
        conn.rollback()
        logger.error(f"Error occurred during sanitization: {exc}. Transaction rolled back.")
        if execute and backup_path and os.path.exists(backup_path):
            logger.warning(f"Restoring database from backup: {backup_path} -> {db_path}")
            shutil.copyfile(backup_path, db_path)
            logger.warning("Database restored to pre-execution state.")
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Sanitize 1x1 ghost operations from howl.db")
    parser.add_argument(
        "--db",
        default=os.path.join(REPO_ROOT, "backend", "howl.db"),
        help="Path to howl.db SQLite database"
    )
    parser.add_argument(
        "--backup",
        default=None,
        help="Path to write database backup (defaults to <db>.bak)"
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually apply changes to the database (defaults to dry run)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Perform dry run without modifying database (default)"
    )

    args = parser.parse_args()
    execute_mode = args.execute and not args.dry_run

    sanitize_database(
        db_path=os.path.abspath(args.db),
        execute=execute_mode,
        backup_path=os.path.abspath(args.backup) if args.backup else None
    )


if __name__ == "__main__":
    main()
