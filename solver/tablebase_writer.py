"""Database writes for the exact solver.

Deliberately separate from `alphawolf/db/tablebase.py`: the solver is a peer of
the RL pipeline, not a part of it, and depends on nothing but the standard
library. It also never computes canonical hashes — it only ever writes back
under hashes that `core_engine.hashing` already produced.
"""
import json
import os
import sqlite3

DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "..", "backend", "howl.db")


def resolve_db_path(explicit: str | None = None) -> str:
    """Pick the database file: explicit argument, DATABASE_URL, or the default."""
    path = explicit or os.environ.get("DATABASE_URL") or DEFAULT_DB_PATH
    if path.startswith("sqlite:///"):
        path = path[len("sqlite:///"):]
    return os.path.abspath(path)


def upsert_exact_solution(db_path: str, shape_hash: str, shape_str: str,
                          rank: int, cut_sequence: list) -> str:
    """Record a provably optimal rank.

    Unlike the RL pipeline's upsert_subgraph (whose is_optimal flag is limited
    to the rank<=4 induction), this marks an entry optimal for any rank, because
    the solver's result is exhaustive.

    Returns 'inserted', 'improved', 'confirmed' or 'conflict'. The last means
    the database claims a rank *below* the proven optimum, which can only happen
    with corrupt data — it is reported, never silently overwritten.
    """
    sequence_json = json.dumps(cut_sequence)
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT best_rank FROM subgraph_dictionary WHERE hash = ?", (shape_hash,))
        row = cursor.fetchone()

        if row is None:
            cursor.execute(
                """
                INSERT INTO subgraph_dictionary
                    (hash, shape_str, best_rank, is_optimal, best_cut_sequence, discovered_by, last_updated)
                VALUES (?, ?, ?, 1, ?, 'solver', CURRENT_TIMESTAMP)
                """,
                (shape_hash, shape_str, rank, sequence_json),
            )
            status = "inserted"
        elif rank < row[0]:
            cursor.execute(
                """
                UPDATE subgraph_dictionary
                SET best_rank = ?, is_optimal = 1, best_cut_sequence = ?, discovered_by = 'solver',
                    shape_str = COALESCE(shape_str, ?), last_updated = CURRENT_TIMESTAMP
                WHERE hash = ?
                """,
                (rank, sequence_json, shape_str, shape_hash),
            )
            status = "improved"
        elif rank == row[0]:
            # The stored best-known solution is in fact optimal; keep it, set the flag
            cursor.execute(
                "UPDATE subgraph_dictionary SET is_optimal = 1, last_updated = CURRENT_TIMESTAMP WHERE hash = ?",
                (shape_hash,),
            )
            status = "confirmed"
        else:
            status = "conflict"

        conn.commit()
    finally:
        conn.close()

    return status


def fetch_unproven_shapes(db_path: str, max_cells: int) -> list[tuple]:
    """Shapes that are recorded but not yet proven optimal, smallest first."""
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(
            """
            SELECT hash, shape_str, best_rank,
                   LENGTH(shape_str) - LENGTH(REPLACE(shape_str, '|', '')) + 1 AS cells
            FROM subgraph_dictionary
            WHERE is_optimal = 0 AND shape_str IS NOT NULL AND cells BETWEEN 2 AND ?
            ORDER BY cells ASC
            """,
            (max_cells,),
        ).fetchall()
    finally:
        conn.close()
