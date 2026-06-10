from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_

from database import get_db
from models import GridSolution, SubgraphDictionary
from schemas import (
    CheckShapesRequest,
    CheckShapesResponse,
    ShapeResult,
    SolutionCreate,
    SolutionResponse,
    SubmitResponse,
)
from routes.auth import verify_token
from services.subgraph_service import update_subgraph_dictionary
from core_engine.hashing import generate_canonical_data

router = APIRouter()




@router.post("/submit_solution", response_model=SubmitResponse)
def submit_solution(payload: SolutionCreate, token: str = Depends(verify_token), db: Session = Depends(get_db)) -> SubmitResponse:
    if payload.solver_name.lower() in ["computer", "alphawolf", "god"]:
        raise HTTPException(status_code=403, detail="Reserved system alias")

    existing = (
        db.query(GridSolution)
        .filter(
            GridSolution.m == payload.m,
            GridSolution.n == payload.n,
            GridSolution.solver_name == payload.solver_name,
        )
        .first()
    )

    # ALWAYS update the subgraph dictionary and compute true rank
    computed_rank = update_subgraph_dictionary(db, payload.m, payload.n, payload.cut_sequence, payload.solver_name)
    
    if computed_rank != payload.achieved_rank:
        raise HTTPException(status_code=400, detail=f"Rank mismatch: client claimed {payload.achieved_rank}, but server computed {computed_rank}")

    if existing is None:
        solution = GridSolution(
            m=payload.m,
            n=payload.n,
            rank=computed_rank,
            solver_name=payload.solver_name,
            cut_sequence=payload.cut_sequence,
        )
        db.add(solution)
        try:
            db.commit()
            db.refresh(solution)
            return SubmitResponse(updated=True, solution=solution)
        except IntegrityError:
            db.rollback()
            computed_rank = update_subgraph_dictionary(db, payload.m, payload.n, payload.cut_sequence, payload.solver_name)
            existing = (
                db.query(GridSolution)
                .filter(
                    GridSolution.m == payload.m,
                    GridSolution.n == payload.n,
                    GridSolution.solver_name == payload.solver_name,
                )
                .first()
            )
            if existing is None:
                raise HTTPException(
                    status_code=500,
                    detail="Failed to retrieve solution after IntegrityError",
                )

    if computed_rank < existing.rank:
        existing.rank = computed_rank
        existing.cut_sequence = payload.cut_sequence
        existing.created_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(existing)
        return SubmitResponse(updated=True, solution=existing)

    db.commit()
    return SubmitResponse(updated=False, solution=existing)


@router.get("/solution/{m}/{n}", response_model=Optional[SolutionResponse])
def get_solution(m: int, n: int, solver_name: Optional[str] = None, token: str = Depends(verify_token), db: Session = Depends(get_db)):
    query = db.query(GridSolution).filter(
        or_(
            (GridSolution.m == m) & (GridSolution.n == n),
            (GridSolution.m == n) & (GridSolution.n == m),
        )
    )
    if solver_name:
        query = query.filter(GridSolution.solver_name == solver_name)
    return query.order_by(GridSolution.rank.asc(), GridSolution.created_at.asc()).first()


@router.post("/check_shapes", response_model=CheckShapesResponse)
def check_shapes(payload: CheckShapesRequest, token: str = Depends(verify_token), db: Session = Depends(get_db)) -> CheckShapesResponse:
    """
    For each subgraph in the request, generate a canonical hash and look up
    whether a known solution exists in the SubgraphDictionary.
    """
    results: list[ShapeResult] = []

    for subgraph in payload.subgraphs:
        canonical_data = generate_canonical_data(subgraph.vertices)
        canonical_hash = canonical_data["hash"]
        shape_str = canonical_data.get("shape_str")

        entry = (
            db.query(SubgraphDictionary).filter(SubgraphDictionary.hash == canonical_hash).first()
        )

        if entry:
            results.append(
                ShapeResult(
                    index=subgraph.index,
                    hash=canonical_hash,
                    shape_str=shape_str,
                    found=True,
                    best_rank=entry.best_rank,
                    is_optimal=entry.is_optimal,
                    best_cut_sequence=entry.best_cut_sequence,
                    discovered_by=entry.discovered_by,
                    last_updated=entry.last_updated,
                )
            )
        else:
            results.append(
                ShapeResult(
                    index=subgraph.index,
                    hash=canonical_hash,
                    shape_str=shape_str,
                    found=False,
                )
            )

    return CheckShapesResponse(results=results)
