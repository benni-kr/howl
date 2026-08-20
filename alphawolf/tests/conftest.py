import os
import sys
import sqlite3
import pytest

# Ensure alphawolf, core_engine, and repository root are on sys.path
ALPHAWOLF_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ROOT_DIR = os.path.abspath(os.path.join(ALPHAWOLF_DIR, ".."))
CORE_ENGINE_DIR = os.path.join(ROOT_DIR, "core_engine")

for path in [ALPHAWOLF_DIR, ROOT_DIR, CORE_ENGINE_DIR]:
    if path not in sys.path:
        sys.path.insert(0, path)

import db.tablebase as tb


@pytest.fixture
def isolated_db(tmp_path):
    """Provides a clean temporary SQLite database with the full HOWL schema."""
    test_db = str(tmp_path / "test_alphawolf.db")
    conn = sqlite3.connect(test_db)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE subgraph_dictionary (
            hash TEXT PRIMARY KEY,
            shape_str TEXT,
            best_rank INTEGER,
            is_optimal BOOLEAN,
            best_cut_sequence TEXT,
            discovered_by TEXT,
            last_updated TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE grid_solutions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            m INTEGER NOT NULL,
            n INTEGER NOT NULL,
            rank INTEGER NOT NULL,
            solver_name TEXT NOT NULL,
            cut_sequence TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_grid_solver UNIQUE (m, n, solver_name)
        )
    """)
    conn.commit()
    conn.close()

    orig_env = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = test_db
    orig_path = tb.DB_PATH
    tb.DB_PATH = test_db
    tb._read_conn = None
    tb._read_conn_pid = None
    tb._read_conn_path = None

    yield test_db

    if orig_env is not None:
        os.environ["DATABASE_URL"] = orig_env
    else:
        os.environ.pop("DATABASE_URL", None)
    tb.DB_PATH = orig_path
    tb._read_conn = None
    tb._read_conn_pid = None
    tb._read_conn_path = None
