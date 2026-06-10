import os
import sys
import logging
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SQLALCHEMY_DATABASE_URL
from models import SubgraphDictionary

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migrate_rank4")

def run_migration():
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    with Session(engine) as session:
        logger.info("Running Rank 4 Induction Migration...")
        # Update any shape with best_rank <= 4 to be marked as optimal
        updated_count = session.query(SubgraphDictionary).filter(
            SubgraphDictionary.best_rank <= 4,
            SubgraphDictionary.is_optimal == False
        ).update({"is_optimal": True})
        
        session.commit()
        logger.info(f"Migration complete. {updated_count} shapes updated to optimal.")

if __name__ == "__main__":
    run_migration()
