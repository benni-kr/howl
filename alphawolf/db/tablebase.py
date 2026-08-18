import sqlite3
import os

from core_engine.hashing import generate_canonical_hash

DB_PATH = os.environ.get("DATABASE_URL", "../backend/howl.db")
if DB_PATH.startswith("sqlite:///"):
    DB_PATH = DB_PATH.replace("sqlite:///", "")

def get_db_connection():
    # If the file doesn't exist relative to alphawolf, try absolute or parent
    return sqlite3.connect(DB_PATH)

def query_tablebase(fragments: list) -> dict:
    """
    Queries the SQLite tablebase for the given fragments (GridGraph objects or string hashes).
    Returns a dict mapping the fragment's canonical hash to its best known rank
    and whether it is proven optimal.
    """
    results = {}
    if not fragments:
        return results

    hashes = []
    for frag in fragments:
        if isinstance(frag, str):
            hashes.append(frag)
        else:
            verts = [{"x": x, "y": y} for x, y in frag.vertices]
            hashes.append(generate_canonical_hash(verts))

    conn = get_db_connection()
    cursor = conn.cursor()
    
    placeholders = ",".join(["?"] * len(hashes))
    query = f"SELECT hash, best_rank, is_optimal FROM subgraph_dictionary WHERE hash IN ({placeholders})"
    
    try:
        cursor.execute(query, hashes)
        rows = cursor.fetchall()
        for r_hash, best_rank, is_optimal in rows:
            results[r_hash] = {
                "best_rank": best_rank,
                "is_optimal": bool(is_optimal)
            }
    except sqlite3.OperationalError:
        # Table might not exist yet if DB is fresh
        pass
    finally:
        conn.close()

    return results

def insert_or_update_rank4_induction(shape_hash: str, rank: int, sequence: list):
    """
    Inserts a newly discovered Rank 4 shape into the tablebase as officially optimal.
    """
    if rank != 4:
        return

    conn = get_db_connection()
    cursor = conn.cursor()
    import json
    
    try:
        cursor.execute(
            """
            INSERT INTO subgraph_dictionary (hash, best_rank, is_optimal, discovered_by)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(hash) DO UPDATE SET
                best_rank=excluded.best_rank,
                is_optimal=excluded.is_optimal,
                discovered_by=excluded.discovered_by
            WHERE excluded.best_rank < subgraph_dictionary.best_rank
            """,
            (shape_hash, rank, True, "alphawolf")
        )
        conn.commit()
    finally:
        conn.close()

def upsert_subgraph(shape_hash: str, shape_str: str, best_rank: int, best_cut_sequence: list, discovered_by="alphawolf"):
    """
    Inserts or updates a subgraph ranking discovery.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    import json
    
    is_optimal = bool(best_rank <= 4)
    sequence_json = json.dumps(best_cut_sequence)
    
    try:
        # Check if hash exists
        cursor.execute("SELECT best_rank FROM subgraph_dictionary WHERE hash = ?", (shape_hash,))
        row = cursor.fetchone()
        
        if row is None:
            # Insert new
            cursor.execute(
                """
                INSERT INTO subgraph_dictionary (hash, shape_str, best_rank, is_optimal, best_cut_sequence, discovered_by, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (shape_hash, shape_str, best_rank, is_optimal, sequence_json, discovered_by)
            )
        else:
            existing_rank = row[0]
            if best_rank < existing_rank:
                # Update better rank and shape_str
                cursor.execute(
                    """
                    UPDATE subgraph_dictionary 
                    SET shape_str = COALESCE(shape_str, ?), best_rank = ?, is_optimal = ?, best_cut_sequence = ?, discovered_by = ?, last_updated = CURRENT_TIMESTAMP
                    WHERE hash = ?
                    """,
                    (shape_str, best_rank, is_optimal, sequence_json, discovered_by, shape_hash)
                )
            else:
                # Rank is same or worse, but we might still need to backfill shape_str
                cursor.execute(
                    """
                    UPDATE subgraph_dictionary 
                    SET shape_str = ?
                    WHERE hash = ? AND shape_str IS NULL
                    """,
                    (shape_str, shape_hash)
                )
        conn.commit()
    finally:
        conn.close()

def upsert_grid_solution(m: int, n: int, rank: int, cut_sequence: list, solver_name: str = "alphawolf"):
    """
    Inserts or updates a full grid solution in the leaderboard table.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    import json
    
    sequence_json = json.dumps(cut_sequence)
    
    try:
        cursor.execute(
            "SELECT rank FROM grid_solutions WHERE m = ? AND n = ? AND solver_name = ?", 
            (m, n, solver_name)
        )
        row = cursor.fetchone()
        
        if row is None:
            cursor.execute(
                """
                INSERT INTO grid_solutions (m, n, rank, solver_name, cut_sequence, created_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (m, n, rank, solver_name, sequence_json)
            )
        else:
            existing_rank = row[0]
            if rank < existing_rank:
                cursor.execute(
                    """
                    UPDATE grid_solutions 
                    SET rank = ?, cut_sequence = ?, created_at = CURRENT_TIMESTAMP
                    WHERE m = ? AND n = ? AND solver_name = ?
                    """,
                    (rank, sequence_json, m, n, solver_name)
                )
        conn.commit()
    finally:
        conn.close()
