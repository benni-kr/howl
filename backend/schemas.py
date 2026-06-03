"""Pydantic schemas for solution submission and leaderboard responses."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, field_validator


class SolutionCreate(BaseModel):
    """Payload for POST /api/submit_solution.

    Architecture Note (DTO Pattern):
    This schema exclusively accepts a highly compact JSON payload to save network bandwidth
    and PostgreSQL storage space (~70% reduction in size).

    ``cut_sequence`` format:
      - Cut: ``{"t": "c", "v": [[x,y], ...]}``
      - Vaporize: ``{"t": "v", "v": [[x,y], ...], "r": <optimal_rank>}``
      - Ignore: ``{"t": "i", "v": [[x,y], ...]}``
      - Subgraph: ``{"t": "s", "v": [[x,y], ...]}``
    """

    m: int
    n: int
    achieved_rank: int
    solver_name: str
    cut_sequence: list

    @field_validator("cut_sequence")
    @classmethod
    def validate_cut_sequence(cls, v: list) -> list:
        if not isinstance(v, list):
            raise ValueError("cut_sequence must be a list")
        for i, action in enumerate(v):
            if not isinstance(action, dict):
                raise ValueError(
                    f"cut_sequence[{i}]: expected dict, got {type(action).__name__}"
                )
            t = action.get("t")
            if t not in ("c", "v", "i", "s"):
                raise ValueError(
                    f"cut_sequence[{i}]: 't' must be 'c', 'v', 'i', or 's', got {t!r}"
                )
            if "v" not in action or not isinstance(action["v"], list):
                raise ValueError(
                    f"cut_sequence[{i}]: must have 'v' as a list of [x, y] pairs"
                )
        return v


class SolutionResponse(BaseModel):
    id: int
    m: int
    n: int
    rank: int
    solver_name: str
    cut_sequence: Any

    class Config:
        from_attributes = True


class SubmitResponse(BaseModel):
    updated: bool
    solution: SolutionResponse


# --- Subgraph shape-checking schemas ---


class SubgraphVertices(BaseModel):
    """A single subgraph identified by an index and its vertex list."""
    index: int
    vertices: List[Dict[str, int]]


class CheckShapesRequest(BaseModel):
    """Payload for POST /api/check_shapes."""
    subgraphs: List[SubgraphVertices]


class ShapeResult(BaseModel):
    """Result for a single subgraph lookup."""
    index: int
    hash: str
    shape_str: Optional[str] = None
    found: bool
    best_rank: Optional[int] = None
    is_optimal: Optional[bool] = None
    best_cut_sequence: Optional[list] = None
    discovered_by: Optional[str] = None
    last_updated: Optional[Any] = None


class CheckShapesResponse(BaseModel):
    """Response for POST /api/check_shapes."""
    results: List[ShapeResult]


class MatrixCellResponse(BaseModel):
    m: int
    n: int
    min_rank: int
    solver_name: str
    is_optimal: bool

class TopSolverResponse(BaseModel):
    solver_name: str
    first_places: int

class GridLeaderboardEntry(BaseModel):
    rank_position: int
    solver_name: str
    achieved_rank: int
    created_at: Any # datetime
