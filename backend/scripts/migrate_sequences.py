"""Migrate all verbose-format cut sequences to compact format.

Converts:
  SubgraphDictionary.best_cut_sequence  (verbose → compact)
  GridSolution.cut_sequence             (verbose → compact)

Usage:
  # Local (SQLite):
  python3 scripts/migrate_sequences.py

  # Production (PostgreSQL):
  DATABASE_URL="postgresql://..." python3 scripts/migrate_sequences.py
"""
import os
import sys
import json

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core_engine.graph_logic import _normalize_sequence

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./howl.db")
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _parse_sequence(raw) -> list | None:
    """Parse a sequence value from the DB which may be a list or a JSON string."""
    if raw is None:
        return None
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
    return None


def _is_verbose(seq: list) -> bool:
    """Check if ANY action in the sequence is in verbose format."""
    for action in seq:
        if isinstance(action, dict) and "type" in action and "t" not in action:
            return True
    return False


def migrate():
    session = SessionLocal()

    # ── SubgraphDictionary ──────────────────────────────────────────────
    print("=" * 60)
    print("Migrating SubgraphDictionary.best_cut_sequence")
    print("=" * 60)

    rows = session.execute(
        text("SELECT hash, best_cut_sequence FROM subgraph_dictionary WHERE best_cut_sequence IS NOT NULL")
    ).fetchall()

    sub_updated = 0
    sub_skipped = 0
    sub_errors = 0

    for row in rows:
        hash_val = row[0]
        seq = _parse_sequence(row[1])

        if seq is None or not _is_verbose(seq):
            sub_skipped += 1
            continue

        try:
            compact = _normalize_sequence(seq)
            session.execute(
                text("UPDATE subgraph_dictionary SET best_cut_sequence = :seq WHERE hash = :h"),
                {"seq": json.dumps(compact), "h": hash_val}
            )
            sub_updated += 1
        except Exception as e:
            print(f"  Error on hash={hash_val}: {e}")
            sub_errors += 1

    print(f"  Updated: {sub_updated}, Skipped: {sub_skipped}, Errors: {sub_errors}")

    # ── GridSolution ────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("Migrating GridSolution.cut_sequence")
    print("=" * 60)

    rows = session.execute(
        text("SELECT id, cut_sequence FROM grid_solutions WHERE cut_sequence IS NOT NULL")
    ).fetchall()

    sol_updated = 0
    sol_skipped = 0
    sol_errors = 0

    for row in rows:
        sol_id = row[0]
        seq = _parse_sequence(row[1])

        if seq is None or not _is_verbose(seq):
            sol_skipped += 1
            continue

        try:
            compact = _normalize_sequence(seq)
            session.execute(
                text("UPDATE grid_solutions SET cut_sequence = :seq WHERE id = :id"),
                {"seq": json.dumps(compact), "id": sol_id}
            )
            sol_updated += 1
        except Exception as e:
            print(f"  Error on id={sol_id}: {e}")
            sol_errors += 1

    print(f"  Updated: {sol_updated}, Skipped: {sol_skipped}, Errors: {sol_errors}")

    # ── Commit ──────────────────────────────────────────────────────────
    session.commit()
    print(f"\n✓ Migration complete.")
    session.close()


if __name__ == "__main__":
    migrate()
