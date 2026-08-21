---
description: Guidelines for working on the Reinforcement Learning pipeline.
activation:
  type: glob
  pattern: "alphawolf/**"
---

# Reinforcement Learning Guidelines

When working in the `alphawolf/` directory, you are touching the AlphaZero-style RL pipeline.

## 1. AlphaZero Architecture
AlphaWolf uses Monte Carlo Tree Search (MCTS) combined with a PyTorch Policy-Value network (`AlphaWolfNet`). Do not introduce standard Q-learning or external RL libraries (like Ray/RLLib) without explicit permission.

## 2. Tablebase Pruning
The RL engine integrates with the HOWL tablebase. MCTS nodes must query the tablebase (via `db/tablebase.py`) before relying entirely on Neural Network evaluations. If a shape has an `is_optimal` flag or `rank <= 3` in the tablebase, it must short-circuit the MCTS branch.

## 3. Symmetries
$D_4$ invariance is mandatory, but **how** it is enforced depends on the architecture:

- **Canonical hashing (always required)**: every tablebase lookup and write must go through `core_engine.hashing`, so a shape and its 8 rotations/reflections resolve to one entry. Never bypass this — it is what makes the shared dictionary effective.
- **Replay buffer augmentation (architecture-dependent)**: the current `AlphaWolfGNN` is *structurally* invariant. Its node features (degree, border, component id, articulation point) carry no coordinates, so a rotated board is an isomorphic graph with identical features and produces bit-identical outputs. Augmenting rotations would recompute the same gradient 8 times for no new information, and `get_symmetries()` was therefore dropped in `08d466f`.

If the architecture ever moves back to a positional representation (CNN, or node features that encode coordinates), rotation/reflection augmentation of the replay buffer becomes required again — verify with an asymmetric board that rotations no longer yield identical values before relying on the structural property.

## 4. Benchmarking
Never overwrite `best_model.pt` directly. Any new model iteration must go through `benchmark.py` and prove superiority over the baseline gauntlet.
