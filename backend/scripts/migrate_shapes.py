import os
import sys
import logging

# Setup imports to work from scripts directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from sqlalchemy import text
from database import SessionLocal
from models import GridSolution, SubgraphDictionary
from core_engine.replay_engine import replay_and_extract_subgraphs

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def migrate_shapes():
    db: Session = SessionLocal()
    try:
        # 1. Ensure the column exists (useful if Alembic isn't used or DB was just updated)
        try:
            db.execute(text("ALTER TABLE subgraph_dictionary ADD COLUMN IF NOT EXISTS shape_str TEXT;"))
            db.commit()
            logger.info("Ensured shape_str column exists in subgraph_dictionary.")
        except Exception as e:
            db.rollback()
            logger.warning(f"Could not automatically add shape_str column (might already exist or SQLite syntax): {e}")

        # 2. Fetch all GridSolutions
        solutions = db.query(GridSolution).all()
        logger.info(f"Found {len(solutions)} GridSolutions to replay and extract geometry from.")

        updated_count = 0

        # We keep track of what we've seen so we don't spam the DB with redundant updates
        seen_hashes = set()

        for sol in solutions:
            try:
                ranks_dict, _ = replay_and_extract_subgraphs(sol.m, sol.n, sol.cut_sequence)
            except Exception as e:
                logger.error(f"Error replaying GridSolution ID={sol.id}: {e}")
                continue

            if not ranks_dict:
                continue

            for canonical_hash, data in ranks_dict.items():
                if canonical_hash in seen_hashes:
                    continue
                
                shape_str = data.get("shape_str")
                if not shape_str:
                    continue
                
                # We do a direct UPDATE query to be fast
                result = db.execute(
                    text("UPDATE subgraph_dictionary SET shape_str = :shape_str WHERE hash = :hash AND shape_str IS NULL"),
                    {"shape_str": shape_str, "hash": canonical_hash}
                )
                
                if result.rowcount > 0:
                    updated_count += result.rowcount
                    
                seen_hashes.add(canonical_hash)

        db.commit()
        logger.info(f"Migration complete! Updated shape_str for {updated_count} subgraphs.")

    except Exception as e:
        logger.error(f"Fatal error during migration: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    migrate_shapes()
