"""FastAPI backend bridge for the HOWL grid-ranking game."""

from __future__ import annotations

from typing import List, Optional, Tuple

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

import logging
import traceback as _tb

from database import Base, engine, get_db
from graph_logic import GridGraph, generate_canonical_hash, replay_and_extract_subgraphs
from models import GridSolution, SubgraphDictionary
from schemas import (
    CheckShapesRequest,
    CheckShapesResponse,
    ShapeResult,
    SolutionCreate,
    SolutionResponse,
    SubmitResponse,
)

Coordinate = Tuple[int, int]
Edge = Tuple[Coordinate, Coordinate]


class CutRequest(BaseModel):
    """Payload for applying a cut set to a grid graph."""

    vertices: List[Coordinate]
    edges: Optional[List[Edge]] = None
    cut_set: List[Coordinate]


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from fastapi.responses import JSONResponse
from fastapi import Request


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback

    tb_str = traceback.format_exc()
    with open("crash.log", "a") as f:
        f.write(f"Exception on {request.url}:\n{tb_str}\n")

    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}", "traceback": tb_str},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        },
    )


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


def _build_graph(vertices: List[Coordinate], edges: Optional[List[Edge]]) -> GridGraph:
    if not vertices:
        graph = GridGraph(1, 1, generate=False)
        graph.vertices = set()
        graph.adjacency = {}
        return graph

    max_x = max(x for x, _ in vertices)
    max_y = max(y for _, y in vertices)
    graph = GridGraph(max_x + 1, max_y + 1, generate=False)

    vertex_set = {tuple(vertex) for vertex in vertices}
    adjacency = {vertex: set() for vertex in vertex_set}

    if edges is None:
        for x, y in vertex_set:
            right = (x + 1, y)
            down = (x, y + 1)
            if right in vertex_set:
                adjacency[(x, y)].add(right)
                adjacency[right].add((x, y))
            if down in vertex_set:
                adjacency[(x, y)].add(down)
                adjacency[down].add((x, y))
    else:
        for a, b in edges:
            a_coord = tuple(a)
            b_coord = tuple(b)
            if a_coord not in vertex_set or b_coord not in vertex_set:
                continue
            adjacency[a_coord].add(b_coord)
            adjacency[b_coord].add(a_coord)

    graph.vertices = vertex_set
    graph.adjacency = adjacency
    return graph


def _serialize_graph(graph: GridGraph) -> dict:
    vertices = sorted(graph.vertices, key=lambda v: (v[0], v[1]))
    edges: List[Edge] = []
    seen = set()

    for a, neighbors in graph.adjacency.items():
        for b in neighbors:
            key = (a, b) if a <= b else (b, a)
            if key in seen:
                continue
            seen.add(key)
            edges.append(key)

    edges.sort(key=lambda e: (e[0][0], e[0][1], e[1][0], e[1][1]))
    return {
        "vertices": [[x, y] for x, y in vertices],
        "edges": [[[a[0], a[1]], [b[0], b[1]]] for a, b in edges],
    }


@app.post("/api/cut")
def cut_graph(payload: CutRequest, db: Session = Depends(get_db)) -> dict:
    """
    Apply a cut set to the provided graph and return disconnected subgraphs.
    """
    graph = _build_graph(payload.vertices, payload.edges)
    graph.apply_cut_set(payload.cut_set)
    subgraphs = graph.get_disconnected_subgraphs()

    serialized = []
    for subgraph in subgraphs:
        sg_data = _serialize_graph(subgraph)
        serialized.append(sg_data)

    db.commit()
    return {"subgraphs": serialized}


@app.get("/api/leaderboard", response_model=List[SolutionResponse])
def get_leaderboard(db: Session = Depends(get_db)) -> List[GridSolution]:
    return db.query(GridSolution).order_by(GridSolution.m.asc(), GridSolution.n.asc()).all()


logger = logging.getLogger("howl.submit")


def update_subgraph_dictionary(db: Session, m: int, n: int, cut_sequence: object) -> None:
    """Replay *cut_sequence* on an m×n grid and upsert discovered subgraph ranks.

    This is intentionally **fault-tolerant**: a replay crash is logged but
    never blocks the caller from saving the ``GridSolution``.
    """
    try:
        ranks_dict = replay_and_extract_subgraphs(m, n, cut_sequence)
    except Exception:
        logger.error("Replay engine failed for %dx%d:\n%s", m, n, _tb.format_exc())
        return

    logger.info("Replay produced %d subgraph entries for %dx%d", len(ranks_dict), m, n)
    for canonical_hash, rank in ranks_dict.items():
        sub_entry = (
            db.query(SubgraphDictionary).filter(SubgraphDictionary.hash == canonical_hash).first()
        )
        if sub_entry is None:
            sub_entry = SubgraphDictionary(
                hash=canonical_hash,
                best_rank=rank,
                is_optimal=False,
            )
            db.add(sub_entry)
        else:
            if rank < sub_entry.best_rank:
                sub_entry.best_rank = rank


@app.post("/api/submit_solution", response_model=SubmitResponse)
def submit_solution(payload: SolutionCreate, db: Session = Depends(get_db)) -> SubmitResponse:
    existing = (
        db.query(GridSolution)
        .filter(
            GridSolution.m == payload.m,
            GridSolution.n == payload.n,
            GridSolution.solver_name == payload.solver_name,
        )
        .first()
    )

    # ALWAYS update the subgraph dictionary — every play-through produces
    # valuable subgraph data, regardless of whether the overall grid score
    # is a new record.
    update_subgraph_dictionary(db, payload.m, payload.n, payload.cut_sequence)

    # Flush subgraph dictionary writes so they survive a potential
    # IntegrityError rollback on the GridSolution insert below.
    db.flush()

    if existing is None:
        solution = GridSolution(
            m=payload.m,
            n=payload.n,
            rank=payload.achieved_rank,
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
            # Concurrent insert — re-query. Subgraph dictionary writes were
            # already flushed; re-apply them in the new transaction.
            update_subgraph_dictionary(db, payload.m, payload.n, payload.cut_sequence)
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

    if payload.achieved_rank < existing.rank:
        existing.rank = payload.achieved_rank
        existing.cut_sequence = payload.cut_sequence
        db.commit()
        db.refresh(existing)
        return SubmitResponse(updated=True, solution=existing)

    db.commit()
    return SubmitResponse(updated=False, solution=existing)


@app.get("/api/solution/{m}/{n}", response_model=Optional[SolutionResponse])
def get_solution(m: int, n: int, db: Session = Depends(get_db)):
    # Returns the absolute best solution globally for this grid size
    return (
        db.query(GridSolution)
        .filter(GridSolution.m == m, GridSolution.n == n)
        .order_by(GridSolution.rank.asc(), GridSolution.created_at.asc())
        .first()
    )


from sqlalchemy import func


@app.get("/api/leaderboard/matrix")
def get_matrix_leaderboard(db: Session = Depends(get_db)):
    """
    Returns the best records for grids up to 100x100 where m >= n.
    Provides a flat list of {m, n, min_rank, solver_name, is_optimal}.
    """
    # Subquery to find the minimum rank for each (m, n)
    min_ranks = (
        db.query(GridSolution.m, GridSolution.n, func.min(GridSolution.rank).label("min_rank"))
        .filter(GridSolution.m >= GridSolution.n)
        .filter(GridSolution.m <= 100)
        .filter(GridSolution.n <= 100)
        .group_by(GridSolution.m, GridSolution.n)
        .subquery()
    )

    # Join back to get the solver details for that minimum rank.
    # To handle ties where multiple solvers have the same min_rank,
    # we pick the earliest submission (created_at).
    results = (
        db.query(GridSolution)
        .join(
            min_ranks,
            (GridSolution.m == min_ranks.c.m)
            & (GridSolution.n == min_ranks.c.n)
            & (GridSolution.rank == min_ranks.c.min_rank),
        )
        .order_by(GridSolution.created_at.asc())
        .all()
    )

    # Because of ties, joining might return multiple rows per (m, n).
    # We only want the first one (the oldest submission) to be considered the absolute #1 for the matrix display.
    matrix_map = {}
    for r in results:
        key = (r.m, r.n)
        if key not in matrix_map:
            # Check optimal status in SubgraphDictionary
            # Optimal if the best possible sequence matches
            # For now, we will mark is_optimal = False (we can enrich this later if needed)
            matrix_map[key] = {
                "m": r.m,
                "n": r.n,
                "min_rank": r.rank,
                "solver_name": r.solver_name,
                "is_optimal": False,  # placeholder until optimal logic is strictly defined
            }

    return list(matrix_map.values())


@app.get("/api/leaderboard/top_solvers")
def get_top_solvers(square_only: bool = False, db: Session = Depends(get_db)):
    """
    Returns a list of players ranked by the total number of "First Place" records they hold.
    All first places count, even ties.
    """
    query = db.query(GridSolution.m, GridSolution.n, func.min(GridSolution.rank).label("min_rank"))
    if square_only:
        query = query.filter(GridSolution.m == GridSolution.n)
    else:
        query = query.filter(GridSolution.m >= GridSolution.n)  # count unique canonical shapes only

    min_ranks = query.group_by(GridSolution.m, GridSolution.n).subquery()

    # Join back to get ALL solvers who achieved the min_rank for that grid
    results = (
        db.query(GridSolution.solver_name)
        .join(
            min_ranks,
            (GridSolution.m == min_ranks.c.m)
            & (GridSolution.n == min_ranks.c.n)
            & (GridSolution.rank == min_ranks.c.min_rank),
        )
        .all()
    )

    counts = {}
    for r in results:
        counts[r.solver_name] = counts.get(r.solver_name, 0) + 1

    sorted_solvers = sorted(counts.items(), key=lambda x: x[1], reverse=True)
    return [{"solver_name": s[0], "first_places": s[1]} for s in sorted_solvers]


@app.get("/api/leaderboard/grid/{m}/{n}")
def get_grid_leaderboard(m: int, n: int, db: Session = Depends(get_db)):
    results = (
        db.query(GridSolution)
        .filter(GridSolution.m == m, GridSolution.n == n)
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


@app.post("/api/check_shapes", response_model=CheckShapesResponse)
def check_shapes(payload: CheckShapesRequest, db: Session = Depends(get_db)) -> CheckShapesResponse:
    """
    For each subgraph in the request, generate a canonical hash and look up
    whether a known solution exists in the SubgraphDictionary.
    """
    results: list[ShapeResult] = []

    for subgraph in payload.subgraphs:
        canonical_hash = generate_canonical_hash(subgraph.vertices)

        entry = (
            db.query(SubgraphDictionary).filter(SubgraphDictionary.hash == canonical_hash).first()
        )

        if entry:
            results.append(
                ShapeResult(
                    index=subgraph.index,
                    hash=canonical_hash,
                    found=True,
                    best_rank=entry.best_rank,
                    is_optimal=entry.is_optimal,
                )
            )
        else:
            results.append(
                ShapeResult(
                    index=subgraph.index,
                    hash=canonical_hash,
                    found=False,
                )
            )

    return CheckShapesResponse(results=results)
