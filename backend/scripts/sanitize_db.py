import os
import sys
import logging

# Setup imports to work from scripts directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from database import SessionLocal
from models import GridSolution, SubgraphDictionary
from core_engine.replay_engine import replay_and_extract_subgraphs

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def verify_grid_solutions(db: Session):
    logger.info("=== Verifying GridSolutions ===")
    solutions = db.query(GridSolution).all()
    corrupt_count = 0

    for sol in solutions:
        try:
            _, root_rank = replay_and_extract_subgraphs(sol.m, sol.n, sol.cut_sequence)
            
            if root_rank >= 999999:
                logger.error(f"CORRUPT (Incomplete): GridSolution ID={sol.id} ({sol.m}x{sol.n}) by {sol.solver_name}. "
                             f"Claimed rank: {sol.rank}, True rank: INCOMPLETE")
                corrupt_count += 1
            elif root_rank != sol.rank:
                logger.warning(f"MISMATCH: GridSolution ID={sol.id} ({sol.m}x{sol.n}) by {sol.solver_name}. "
                               f"Claimed rank: {sol.rank}, True rank: {root_rank}")
                # We could auto-fix here, but for now we just flag
                corrupt_count += 1
            else:
                logger.debug(f"OK: GridSolution ID={sol.id} ({sol.m}x{sol.n}) by {sol.solver_name}")
                
        except Exception as e:
            logger.error(f"CORRUPT (Exception): GridSolution ID={sol.id} ({sol.m}x{sol.n}) by {sol.solver_name}. "
                         f"Error: {e}")
            corrupt_count += 1

    logger.info(f"GridSolutions Verification Complete. Found {corrupt_count} corrupt/mismatched entries out of {len(solutions)}.")

def sanitize():
    db: Session = SessionLocal()
    try:
        verify_grid_solutions(db)
        
        # SubgraphDictionary entries are harder to verify standalone since we don't have their starting vertices.
        # But we can report how many exist.
        subgraph_count = db.query(SubgraphDictionary).count()
        logger.info(f"=== SubgraphDictionary ===")
        logger.info(f"There are {subgraph_count} entries in the SubgraphDictionary. "
                    "Corrupt subgraphs generated from invalid GridSolutions should be overwritten "
                    "naturally as players submit mathematically verified runs under the new validation gate.")
        
    finally:
        db.close()

if __name__ == "__main__":
    sanitize()
