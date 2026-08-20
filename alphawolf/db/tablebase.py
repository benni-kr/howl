import sqlite3
import os
import sys

_CORE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../core_engine"))
if _CORE_DIR not in sys.path:
    sys.path.insert(0, _CORE_DIR)

from core_engine.hashing import generate_canonical_hash

_DEFAULT_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend/howl.db"))

def get_db_path():
    path = os.environ.get("DATABASE_URL", DB_PATH if 'DB_PATH' in globals() else _DEFAULT_DB_PATH)
    if path.startswith("sqlite:///"):
        path = path.replace("sqlite:///", "")
    return path

DB_PATH = get_db_path()

# In-process lookup cache. Positive hits are kept permanently (a best-known
# rank is always a valid upper bound); misses are kept in a bounded set that
# is cleared whenever this process upserts, so its own discoveries are seen.
# Discoveries made concurrently by other processes may be missed until then,
# which only means falling back to NN evaluation (never unsound).
_MISS_CACHE_LIMIT = 100_000
_hit_cache = {}
_miss_cache = set()

# Persistent read connection, guarded by PID so forked workers reopen their own.
_read_conn = None
_read_conn_pid = None
_read_conn_path = None

def get_db_connection():
    return sqlite3.connect(get_db_path())

def _get_read_connection():
    global _read_conn, _read_conn_pid, _read_conn_path
    pid = os.getpid()
    db_path = get_db_path()
    if _read_conn is None or _read_conn_pid != pid or _read_conn_path != db_path:
        _read_conn = sqlite3.connect(db_path)
        _read_conn_pid = pid
        _read_conn_path = db_path
    return _read_conn

def _invalidate_cache(shape_hash: str):
    _miss_cache.clear()
    _hit_cache.pop(shape_hash, None)

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

    missing = []
    for h in hashes:
        cached = _hit_cache.get(h)
        if cached is not None:
            results[h] = cached
        elif h not in _miss_cache:
            missing.append(h)

    if not missing:
        return results

    cursor = _get_read_connection().cursor()

    placeholders = ",".join(["?"] * len(missing))
    query = f"SELECT hash, best_rank, is_optimal FROM subgraph_dictionary WHERE hash IN ({placeholders})"

    try:
        cursor.execute(query, missing)
        rows = cursor.fetchall()
        found = set()
        for r_hash, best_rank, is_optimal in rows:
            entry = {
                "best_rank": best_rank,
                "is_optimal": bool(is_optimal)
            }
            results[r_hash] = entry
            _hit_cache[r_hash] = entry
            found.add(r_hash)
        if len(_miss_cache) > _MISS_CACHE_LIMIT:
            _miss_cache.clear()
        _miss_cache.update(h for h in missing if h not in found)
    except sqlite3.OperationalError:
        # Table might not exist yet if DB is fresh
        pass

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
        _invalidate_cache(shape_hash)
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
        _invalidate_cache(shape_hash)
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


def validate_and_upsert_solution(m: int, n: int, final_rank: int, final_sequence: list, solver_name: str = "alphawolf") -> bool:
    """
    Strict validation gatekeeper: passes final_sequence through the replay engine
    before writing any data to SQLite.
    
    If the replay reconstruction succeeds and root_rank == final_rank, all extracted
    canonical subgraphs and the full grid solution are persisted.
    Returns True if valid and saved, False if rejected.
    """
    from core_engine.replay_engine import replay_and_extract_subgraphs

    if not final_sequence or final_rank >= 999999:
        return False

    try:
        ranks_dict, root_rank = replay_and_extract_subgraphs(m, n, final_sequence)
        if root_rank >= 999999 or root_rank != final_rank:
            print(f"Warning: Replay validation rejected solution for {m}x{n} (computed {final_rank} != replay {root_rank})")
            return False

        for can_hash, data in ranks_dict.items():
            upsert_subgraph(
                shape_hash=can_hash,
                shape_str=data.get("shape_str"),
                best_rank=data["rank"],
                best_cut_sequence=data["sequence"],
                discovered_by=solver_name
            )

        upsert_grid_solution(m, n, final_rank, final_sequence, solver_name=solver_name)
        return True
    except Exception as e:
        print(f"Warning: Replay validation failed for {m}x{n}: {e}")
        return False

