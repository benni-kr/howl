import logging
import traceback as _tb
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from models import SubgraphDictionary
from graph_logic import replay_and_extract_subgraphs

logger = logging.getLogger("howl.submit")

def update_subgraph_dictionary(db: Session, m: int, n: int, cut_sequence: object, solver_name: str) -> None:
    """Replay *cut_sequence* on an m×n grid and upsert discovered subgraph ranks.

    This acts as a strict validation layer: if the replay engine fails to 
    reconstruct the run, the entire score submission is rejected.
    """
    try:
        ranks_dict = replay_and_extract_subgraphs(m, n, cut_sequence)
        if not ranks_dict:
            return

        logger.info("Replay produced %d subgraph entries for %dx%d", len(ranks_dict), m, n)
        
        # Bulk query all existing hashes to avoid N+1 SELECT queries
        hashes = list(ranks_dict.keys())
        existing_entries = db.query(SubgraphDictionary).filter(SubgraphDictionary.hash.in_(hashes)).all()
        existing_map = {e.hash: e for e in existing_entries}

        for canonical_hash, data in ranks_dict.items():
            rank = data["rank"]
            sequence = data["sequence"]
            sub_entry = existing_map.get(canonical_hash)

            if sub_entry is None:
                sub_entry = SubgraphDictionary(
                    hash=canonical_hash,
                    best_rank=rank,
                    best_cut_sequence=sequence,
                    is_optimal=False,
                    discovered_by=solver_name,
                    last_updated=datetime.now(timezone.utc),
                )
                db.add(sub_entry)
            else:
                if rank < sub_entry.best_rank:
                    sub_entry.best_rank = rank
                    sub_entry.best_cut_sequence = sequence
                    sub_entry.discovered_by = solver_name
                    sub_entry.last_updated = datetime.now(timezone.utc)
                elif rank == sub_entry.best_rank and not sub_entry.best_cut_sequence:
                    sub_entry.best_cut_sequence = sequence
                    sub_entry.discovered_by = solver_name
                    sub_entry.last_updated = datetime.now(timezone.utc)
        
        # Flush subgraph dictionary writes so they survive a potential
        # IntegrityError rollback on the GridSolution insert later.
        db.flush()

    except Exception as e:
        # Replay failed: meaning the run is mathematically invalid or corrupted.
        db.rollback()
        logger.error("Subgraph validation failed for %dx%d:\n%s", m, n, _tb.format_exc())
        raise HTTPException(
            status_code=400,
            detail=f"Invalid cut sequence: the replay engine failed to reconstruct the run. ({str(e)})"
        )
