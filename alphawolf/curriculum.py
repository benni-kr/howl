"""
Curriculum Learning Manager for AlphaWolf.

Orchestrates developmental board size progression using Triangulated Reference Targets,
Frontier-Biased Sampling, and Fast-Track Mastery Advancement.
"""

from __future__ import annotations

import math
import random
from typing import Any

from bounds import get_effective_target, get_lower_bound
from db.tablebase import query_tablebase
from core_engine.hashing import generate_canonical_hash


class CurriculumManager:
    """
    Manages grid dimensions sampling and progression across training generations.

    Supported modes:
    - 'hybrid' (default): Staged progression with fast-track mastery unlock (>=80% success) + stage timeout fallback.
    - 'staged': Fixed generation stage allocations.
    - 'linear': Smooth continuous linear ramp of maximum grid dimension.
    - 'uniform': Flat uniform sampling across [min_grid, max_grid] (no curriculum).
    """

    def __init__(
        self,
        mode: str = "hybrid",
        min_grid: int = 4,
        max_grid: int = 9,
        total_generations: int = 50,
        frontier_ratio: float = 0.70,
        success_threshold: float = 0.80,
        stages: list[dict[str, Any]] | None = None,
    ):
        self.mode = mode.lower()
        self.min_grid = min_grid
        self.max_grid = max_grid
        self.total_generations = total_generations
        self.frontier_ratio = frontier_ratio
        self.success_threshold = success_threshold

        # Default developmental stages if none provided
        if stages is None:
            self.stages = [
                {"max_size": 5, "fraction": 0.25, "name": "Foundations (4x4-5x5)"},
                {"max_size": 7, "fraction": 0.35, "name": "Intermediate (4x4-7x7)"},
                {"max_size": self.max_grid, "fraction": 0.40, "name": f"Full Scale (4x4-{self.max_grid}x{self.max_grid})"},
            ]
        else:
            self.stages = stages

        # Calculate max generation budgets per stage if not explicitly set
        for stage in self.stages:
            if "max_gens" not in stage:
                frac = stage.get("fraction", 1.0 / len(self.stages))
                stage["max_gens"] = max(1, round(frac * self.total_generations))

        self.current_stage_idx = 0
        self.stage_generations_spent = 0
        self.history: list[dict[str, Any]] = []

    @property
    def active_stage(self) -> dict[str, Any]:
        idx = min(self.current_stage_idx, len(self.stages) - 1)
        return self.stages[idx]

    @property
    def current_max_size(self) -> int:
        if self.mode == "uniform":
            return self.max_grid
        return min(self.active_stage.get("max_size", self.max_grid), self.max_grid)

    def sample_games(self, count: int, current_generation: int) -> list[tuple[int, int]]:
        """
        Samples a list of (m, n) grid dimensions for the upcoming generation.
        """
        if self.mode == "uniform":
            return [
                (random.randint(self.min_grid, self.max_grid), random.randint(self.min_grid, self.max_grid))
                for _ in range(count)
            ]

        if self.mode == "linear":
            if self.total_generations <= 1:
                cur_max = self.max_grid
            else:
                progress = max(0.0, min(1.0, (current_generation - 1) / (self.total_generations - 1)))
                cur_max = round(self.min_grid + progress * (self.max_grid - self.min_grid))
            return [
                (random.randint(self.min_grid, cur_max), random.randint(self.min_grid, cur_max))
                for _ in range(count)
            ]

        # Staged or Hybrid mode: Frontier-Biased Sampling
        k_max = self.current_max_size
        k_front = max(self.min_grid, k_max - 1)
        k_found = max(self.min_grid, k_max - 2)

        sampled: list[tuple[int, int]] = []
        for _ in range(count):
            if k_max <= self.min_grid:
                sampled.append((self.min_grid, self.min_grid))
                continue

            # 70% frontier games, 30% foundational replay
            if random.random() < self.frontier_ratio or k_found < self.min_grid:
                # Frontier: at least one dimension >= k_front
                while True:
                    m = random.randint(self.min_grid, k_max)
                    n = random.randint(self.min_grid, k_max)
                    if max(m, n) >= k_front or k_front <= self.min_grid:
                        sampled.append((m, n))
                        break
            else:
                # Foundational base: both dimensions <= k_found
                m = random.randint(self.min_grid, k_found)
                n = random.randint(self.min_grid, k_found)
                sampled.append((m, n))

        return sampled

    def record_generation_results(
        self,
        generation: int,
        results: list[tuple[int, int, int]],
        db_records: dict[tuple[int, int], int] | None = None,
    ) -> dict[str, Any]:
        """
        Evaluates played games against Triangulated Reference Targets and updates stage status.

        Args:
            generation: The current generation index.
            results: List of (m, n, achieved_rank).
            db_records: Optional mapping of (m, n) -> best known rank in DB.

        Returns:
            Dictionary containing generation curriculum metrics.
        """
        if db_records is None:
            db_records = {}

        total_games = len(results)
        games_met_target = 0
        game_details = []

        for m, n, rank in results:
            canon_m, canon_n = max(m, n), min(m, n)
            db_rec = db_records.get((canon_m, canon_n))
            if db_rec is None:
                # Query tablebase for canonical rectangle if available
                can_hash = generate_canonical_hash([{"x": x, "y": y} for x in range(canon_m) for y in range(canon_n)])
                hit = query_tablebase([can_hash]).get(can_hash)
                if hit:
                    db_rec = hit["best_rank"]

            target_info = get_effective_target(canon_m, canon_n, db_record=db_rec)
            target_rank = target_info["target_rank"]

            met = (rank <= target_rank)
            if met:
                games_met_target += 1

            game_details.append({
                "m": m,
                "n": n,
                "achieved_rank": rank,
                "target_rank": target_rank,
                "lower_bound": target_info["lower_bound"],
                "met_target": met,
            })

        success_rate = games_met_target / total_games if total_games > 0 else 0.0
        self.stage_generations_spent += 1

        stage = self.active_stage
        stage_name = stage.get("name", f"Stage {self.current_stage_idx + 1}")
        max_gens = stage.get("max_gens", self.total_generations)

        advanced = False
        advance_reason = None

        if self.current_stage_idx < len(self.stages) - 1:
            if self.mode == "hybrid" and success_rate >= self.success_threshold:
                advanced = True
                advance_reason = f"Mastery achieved ({games_met_target}/{total_games} games, {success_rate:.1%} >= {self.success_threshold:.1%})"
            elif self.stage_generations_spent >= max_gens:
                advanced = True
                advance_reason = f"Stage generation budget reached ({self.stage_generations_spent}/{max_gens} gens)"

            if advanced:
                self.current_stage_idx += 1
                self.stage_generations_spent = 0

        summary = {
            "generation": generation,
            "stage_idx": self.current_stage_idx,
            "stage_name": stage_name,
            "max_size": self.current_max_size,
            "success_rate": success_rate,
            "games_met_target": games_met_target,
            "total_games": total_games,
            "advanced": advanced,
            "advance_reason": advance_reason,
            "game_details": game_details,
        }

        self.history.append(summary)
        return summary

    def state_dict(self) -> dict[str, Any]:
        """Serializes curriculum state for training checkpoints."""
        return {
            "mode": self.mode,
            "current_stage_idx": self.current_stage_idx,
            "stage_generations_spent": self.stage_generations_spent,
            "history": self.history,
        }

    def load_state_dict(self, state: dict[str, Any]) -> None:
        """Restores curriculum state when resuming from a checkpoint."""
        if not state:
            return
        self.current_stage_idx = state.get("current_stage_idx", self.current_stage_idx)
        self.stage_generations_spent = state.get("stage_generations_spent", self.stage_generations_spent)
        self.history = state.get("history", self.history)
