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
Always enforce $D_4$ symmetries when generating replay buffers in `train.py`. Since grid graphs are highly symmetric, every discovered trajectory must be rotated and reflected to maximize training data efficiency.

## 4. Benchmarking
Never overwrite `best_model.pt` directly. Any new model iteration must go through `benchmark.py` and prove superiority over the baseline gauntlet.
