import sqlite3
import os

from core_engine.hashing import generate_canonical_hash

DB_PATH = os.environ.get("DATABASE_URL", "../backend/howl.db")
if DB_PATH.startswith("sqlite:///"):
    DB_PATH = DB_PATH.replace("sqlite:///", "")

def get_db_connection():
    # If the file doesn't exist relative to alphawolf, try absolute or parent
    return sqlite3.connect(DB_PATH)

def query_tablebase(fragments: list["GridGraph"]) -> dict:
    """
    Queries the SQLite tablebase for the given fragments.
    Returns a dict mapping the fragment's canonical hash to its best known rank
    and whether it is proven optimal.
    """
    results = {}
    if not fragments:
        return results

    hashes = []
    for frag in fragments:
        verts = [{"x": x, "y": y} for x, y in frag.vertices]
        can_hash = generate_canonical_hash(verts)
        hashes.append(can_hash)

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
