"""SQLAlchemy models for HOWL."""

from __future__ import annotations

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from database import Base


class GridSolution(Base):
    """Best-known solution for a specific grid size."""

    __tablename__ = "grid_solutions"
    __table_args__ = (UniqueConstraint("m", "n", "solver_name", name="uq_grid_solutions_m_n_solver"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    m: Mapped[int] = mapped_column(Integer, nullable=False)
    n: Mapped[int] = mapped_column(Integer, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    solver_name: Mapped[str] = mapped_column(String, nullable=False)
    cut_sequence: Mapped[object] = mapped_column(JSON, nullable=False)
    created_at = mapped_column(DateTime, server_default=func.now(), nullable=True)


class SubgraphDictionary(Base):
    """Canonical dictionary of previously seen subgraph shapes and their best solutions."""

    __tablename__ = "subgraph_dictionary"

    hash: Mapped[str] = mapped_column(String, primary_key=True)
    best_rank: Mapped[int] = mapped_column(Integer, nullable=False)
    is_optimal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    best_cut_sequence: Mapped[object] = mapped_column(JSON, nullable=True)
    discovered_by: Mapped[str] = mapped_column(String, nullable=True)
    last_updated = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=True)
