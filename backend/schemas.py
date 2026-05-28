"""Pydantic schemas for solution submission and leaderboard responses."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, field_validator


class SolutionCreate(BaseModel):
    """Payload for POST /api/submit_solution.

    ``cut_sequence`` accepts two formats:
      - **Legacy:** A list of vertex lists, e.g. ``[[[0,0],[0,1]], ...]``
      - **Current:** A list of typed action dicts, e.g.
        ``[{"type": "cut", "vertices": [{"x":0,"y":0}]}, ...]``
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
            if isinstance(action, list):
                # Legacy format: list of [x, y] pairs — accepted as-is
                continue
            if isinstance(action, dict):
                if "type" not in action and "vertices" not in action:
                    raise ValueError(
                        f"cut_sequence[{i}]: dict must have 'type' or 'vertices' key"
                    )
                continue
            raise ValueError(
                f"cut_sequence[{i}]: expected list or dict, got {type(action).__name__}"
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
