from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, case, or_

from database import get_db
from models import GridSolution
from schemas import SolutionResponse
from routes.auth import verify_token

router = APIRouter()

@router.get("", response_model=List[SolutionResponse])
def get_leaderboard(token: str = Depends(verify_token), db: Session = Depends(get_db)) -> List[GridSolution]:
    return db.query(GridSolution).order_by(GridSolution.m.asc(), GridSolution.n.asc()).all()

def is_ai_name(name: str) -> bool:
    if not name:
        return False
    n = name.lower()
    return "alphawolf" in n or "computer" in n

AI_FILTER = or_(
    GridSolution.solver_name.ilike("%alphawolf%"),
    GridSolution.solver_name.ilike("%computer%")
)

@router.get("/matrix")
def get_matrix_leaderboard(solver_type: str = "all", token: str = Depends(verify_token), db: Session = Depends(get_db)):
    """
    Returns the best records for grids up to 100×100.
    Groups (m, n) and (n, m) as the same canonical grid and returns
    a flat list of {m, n, min_rank, solver_name, is_optimal, is_ai}.
    solver_type: 'all' | 'humans' | 'ai'
    """
    canonical_m = case(
        (GridSolution.m >= GridSolution.n, GridSolution.m),
        else_=GridSolution.n
    ).label("canonical_m")

    canonical_n = case(
        (GridSolution.m >= GridSolution.n, GridSolution.n),
        else_=GridSolution.m
    ).label("canonical_n")

    # Subquery: best rank per canonical grid
    min_ranks_query = (
        db.query(
            canonical_m,
            canonical_n,
            func.min(GridSolution.rank).label("min_rank"),
        )
        .filter(GridSolution.m <= 100)
        .filter(GridSolution.n <= 100)
    )

    results_query = db.query(GridSolution)

    if solver_type == "humans":
        min_ranks_query = min_ranks_query.filter(~AI_FILTER)
        results_query = results_query.filter(~AI_FILTER)
    elif solver_type == "ai":
        min_ranks_query = min_ranks_query.filter(AI_FILTER)
        results_query = results_query.filter(AI_FILTER)

    min_ranks = min_ranks_query.group_by("canonical_m", "canonical_n").subquery()

    # Join back to get solver details for the best rank.
    results = (
        results_query
        .join(
            min_ranks,
            (case((GridSolution.m >= GridSolution.n, GridSolution.m), else_=GridSolution.n) == min_ranks.c.canonical_m)
            & (case((GridSolution.m >= GridSolution.n, GridSolution.n), else_=GridSolution.m) == min_ranks.c.canonical_n)
            & (GridSolution.rank == min_ranks.c.min_rank),
        )
        .order_by(GridSolution.created_at.asc())
        .all()
    )

    # De-duplicate ties — keep only the earliest submission per canonical grid.
    matrix_map = {}
    for r in results:
        key = (max(r.m, r.n), min(r.m, r.n))
        if key not in matrix_map:
            matrix_map[key] = {
                "m": key[0],
                "n": key[1],
                "min_rank": r.rank,
                "solver_name": r.solver_name,
                "is_optimal": False,
                "is_ai": is_ai_name(r.solver_name),
            }

    return list(matrix_map.values())


@router.get("/top_solvers")
def get_top_solvers(solver_type: str = "all", square_only: bool = False, token: str = Depends(verify_token), db: Session = Depends(get_db)):
    """
    Returns a list of players ranked by the total number of "First Place" records
    they hold.  All first places count, even ties.
    Groups (m, n) and (n, m) as the same canonical grid.
    solver_type: 'all' | 'humans' | 'ai'
    """
    canonical_m = case(
        (GridSolution.m >= GridSolution.n, GridSolution.m),
        else_=GridSolution.n
    ).label("canonical_m")

    canonical_n = case(
        (GridSolution.m >= GridSolution.n, GridSolution.n),
        else_=GridSolution.m
    ).label("canonical_n")

    query = db.query(
        canonical_m,
        canonical_n,
        func.min(GridSolution.rank).label("min_rank"),
    )
    if square_only:
        query = query.filter(GridSolution.m == GridSolution.n)

    results_query = db.query(GridSolution)

    if solver_type == "humans":
        query = query.filter(~AI_FILTER)
        results_query = results_query.filter(~AI_FILTER)
    elif solver_type == "ai":
        query = query.filter(AI_FILTER)
        results_query = results_query.filter(AI_FILTER)

    min_ranks = query.group_by("canonical_m", "canonical_n").subquery()

    results = (
        results_query
        .join(
            min_ranks,
            (case((GridSolution.m >= GridSolution.n, GridSolution.m), else_=GridSolution.n) == min_ranks.c.canonical_m)
            & (case((GridSolution.m >= GridSolution.n, GridSolution.n), else_=GridSolution.m) == min_ranks.c.canonical_n)
            & (GridSolution.rank == min_ranks.c.min_rank),
        )
        .order_by(GridSolution.created_at.asc())
        .all()
    )

    # De-duplicate ties — keep only the earliest submission per canonical grid.
    matrix_map = {}
    for r in results:
        key = (max(r.m, r.n), min(r.m, r.n))
        if key not in matrix_map:
            matrix_map[key] = r.solver_name

    counts: dict[str, int] = {}
    for solver_name in matrix_map.values():
        counts[solver_name] = counts.get(solver_name, 0) + 1

    # Fetch total grids solved per user
    total_grids_query = db.query(
        GridSolution.solver_name,
        func.count(GridSolution.id).label("total_grids")
    )
    if solver_type == "humans":
        total_grids_query = total_grids_query.filter(~AI_FILTER)
    elif solver_type == "ai":
        total_grids_query = total_grids_query.filter(AI_FILTER)

    solver_total_grids = total_grids_query.group_by(GridSolution.solver_name).all()
    total_grids_map = {row.solver_name: row.total_grids for row in solver_total_grids}
    
    # Ensure all solvers with at least 1 grid solved are included
    for solver_name in total_grids_map.keys():
        if solver_name not in counts:
            counts[solver_name] = 0

    sorted_solvers = sorted(counts.items(), key=lambda x: (x[1], total_grids_map.get(x[0], 0)), reverse=True)
    return [
        {
            "solver_name": s[0], 
            "first_places": s[1],
            "total_grids": total_grids_map.get(s[0], 0)
        } 
        for s in sorted_solvers
    ]


@router.get("/grid/{m}/{n}")
def get_grid_leaderboard(m: int, n: int, token: str = Depends(verify_token), db: Session = Depends(get_db)):
    """
    Drill-down view: returns all solutions for a specific canonical grid.
    Queries both (m, n) and (n, m) orientations.
    """
    results = (
        db.query(GridSolution)
        .filter(
            or_(
                (GridSolution.m == m) & (GridSolution.n == n),
                (GridSolution.m == n) & (GridSolution.n == m),
            )
        )
        .order_by(GridSolution.rank.asc(), GridSolution.created_at.asc())
        .limit(50)
        .all()
    )
    return [
        {
            "rank_position": i + 1,
            "solver_name": r.solver_name,
            "achieved_rank": r.rank,
            "created_at": r.created_at,
        }
        for i, r in enumerate(results)
    ]
