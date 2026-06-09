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

@router.get("/matrix")
def get_matrix_leaderboard(token: str = Depends(verify_token), db: Session = Depends(get_db)):
    """
    Returns the best records for grids up to 100×100.
    Groups (m, n) and (n, m) as the same canonical grid and returns
    a flat list of {m, n, min_rank, solver_name, is_optimal}.
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
    min_ranks = (
        db.query(
            canonical_m,
            canonical_n,
            func.min(GridSolution.rank).label("min_rank"),
        )
        .filter(GridSolution.m <= 100)
        .filter(GridSolution.n <= 100)
        .group_by("canonical_m", "canonical_n")
        .subquery()
    )

    # Join back to get solver details for the best rank.
    # A solution row matches its canonical grid via max/min.
    results = (
        db.query(GridSolution)
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
            }

    return list(matrix_map.values())


@router.get("/top_solvers")
def get_top_solvers(token: str = Depends(verify_token), square_only: bool = False, db: Session = Depends(get_db)):
    """
    Returns a list of players ranked by the total number of "First Place" records
    they hold.  All first places count, even ties.
    Groups (m, n) and (n, m) as the same canonical grid.
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

    min_ranks = query.group_by("canonical_m", "canonical_n").subquery()

    results = (
        db.query(GridSolution)
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
    solver_total_grids = db.query(
        GridSolution.solver_name,
        func.count(GridSolution.id).label("total_grids")
    ).group_by(GridSolution.solver_name).all()
    
    total_grids_map = {row.solver_name: row.total_grids for row in solver_total_grids}

    sorted_solvers = sorted(counts.items(), key=lambda x: x[1], reverse=True)
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
