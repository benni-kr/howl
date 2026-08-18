# AlphaWolf RL Architecture

> **Audience:** Future contributors and AI agents working on the HOWL reinforcement learning engine.

## Overview

AlphaWolf is the Reinforcement Learning (RL) pipeline for HOWL, designed to compute minimal graph separators for the vertex $k$-ranking problem autonomously. It heavily draws inspiration from the AlphaZero architecture, employing a combination of Monte Carlo Tree Search (MCTS), a policy-value neural network, and self-play.

Unlike standard game engines, AlphaWolf is integrated with a globally shared tablebase containing community-discovered best known shapes, allowing it to efficiently prune branches and bootstrap its learning.

## Tech Stack

- **Framework**: PyTorch
- **Environment**: Custom simulation wrapped similarly to OpenAI Gym (`envs/howl_env.py`)
- **Core Logic**: Interfaces with `core_engine` for grid graph manipulation and hashing
- **Data Persistence**: `db/tablebase.py` for reading/writing known ranks to the backend database
- **Optional**: a dependency-free Rust binary (`solver_rs/`) accelerating the exact solver. Not required — the Python fallback runs the same algorithm.

---

## Data Flow & Training Pipeline

```text
┌────────────────────────────────────────────────────────┐
│                      MCTS (Self-Play)                  │
│  1. Expand nodes using Neural Network priors           │
│  2. Prune known shapes using Tablebase Lookups         │
│  3. Simulate trajectories & collect value targets      │
└──────────────────────────┬─────────────────────────────┘
                           │ Trajectories & Values
                           ▼
┌────────────────────────────────────────────────────────┐
│                   Replay Buffer                        │
│  Stores game states, action probabilities (Pi),        │
│  and calculated intrinsic ranks (Z).                   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                   Neural Network                       │
│  Trains on Buffer (MSE for Values, CrossEntropy        │
│  for Policy). Outputs Policy (p) and Value (v).        │
└──────────────────────────┬─────────────────────────────┘
                           │ New Weights
                           ▼
┌────────────────────────────────────────────────────────┐
│                     Benchmark                          │
│  Pits Challenger model vs Baseline model over a set    │
│  of predetermined 'Gauntlet' grids. Promotes if it     │
│  finds better ranks or explores fewer nodes.           │
└────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Training Loop (`train.py`)

The main training orchestrator implements a mixed curriculum self-play phase. To prevent catastrophic forgetting, the agent plays a combination of games on the current frontier grid size and on historical, smaller unlocked grid sizes. 

During self-play:
- Each MCTS simulation explores possible cuts, guided by the neural network's policy and value heads.
- When an action shatters the graph into subgraphs, AlphaWolf evaluates each fragment. If a fragment is found in the `tablebase`, it immediately returns its known rank, halting the MCTS branch for that fragment.
- Discovered sub-sequences and final best known grid solutions are upserted to the database, ensuring the community UI and future RL generations benefit from the run.

### 2. Neural Network (`models/net.py`)

The `AlphaWolfNet` evaluates states (graphs) using a dual-headed approach:
- **Policy Head**: Outputs probabilities over all possible node cuts. Invalid moves (already cut nodes) are masked out before passing to the softmax activation.
- **Value Head**: Estimates the expected intrinsic rank of the current board state.

To augment data and improve learning efficiency, all generated trajectory steps apply the $D_4$ symmetries (rotations and reflections) during insertion into the replay buffer.

### 3. Environment (`envs/howl_env.py`)

`HowlEnv` is a custom RL environment built around `core_engine.GridGraph`. 
- **State**: Represented as a 2D binary matrix (e.g., $10 \times 10$) where `1` indicates an active vertex and `0` indicates a missing or cut vertex.
- **Action Space**: Flat indexing mapped to 2D coordinates.
- **Step Function**: Takes an action, modifies the graph, recalculates subgraphs (using `get_disconnected_subgraphs()`), and returns the next observation.

### 4. Benchmarking (`benchmark.py`)

To ensure monotonic improvement, AlphaWolf uses an automated gauntlet:
- **The Gauntlet**: A reproducible set of test boards consisting of clean rectangles and asymmetrically fractured grids (simulating complex mid-game states).
- **Promotion Logic**: A challenger model is promoted to `best_model.pt` only if it discovers a strictly lower total rank across the gauntlet, or matches the rank while requiring fewer MCTS node expansions (indicating stronger intuition and higher confidence).

### 5. Tablebase Integration (`db/tablebase.py`)

This module connects AlphaWolf directly to the shared backend database (`howl.db` / `test.db`).
- **`query_tablebase`**: Checks if the canonical hashes of current board shapes have known best solutions. If `is_optimal` is true, or the rank is extremely small ($\le 3$), MCTS stops exploring that subgraph and uses the value.
- **`upsert_subgraph`** / **`upsert_grid_solution`**: Records new discoveries so the React frontend can automatically display Magic Wands and Abacuses for humans who encounter those same states. Both only ever improve an entry (`best_rank <` guard), so a bad run cannot degrade a better human solution. `upsert_subgraph` sets `is_optimal` by the `best_rank <= 4` induction: everything of rank $\le 3$ is in the seed, so a shape absent from it has rank $\ge 4$, and a solution achieving 4 is therefore exact. This is the only optimality any *playing* agent can establish.
- **`upsert_exact_solution`**: the write path reserved for the exact solver — the only one that may set `is_optimal` for arbitrary ranks. Refuses to overwrite silently if the database claims a rank *below* a proven optimum (reported as `conflict`, indicating corrupt data).
- **Caching**: lookups are served from a per-process cache over a persistent SQLite connection. The connection is PID-guarded so forked self-play workers open their own; positive hits are kept indefinitely (a best-known rank stays a valid upper bound), while the miss set is cleared on every local upsert. Discoveries made concurrently by *other* processes may be missed until then, which only means falling back to network evaluation — never an unsound result.

This module uses raw `sqlite3` and can therefore only ever address a **local file**. It cannot write to the production Postgres/Supabase database; pointing `DATABASE_URL` at a Postgres URL would make it try to open a file by that name. Getting AlphaWolf discoveries into production requires a deliberate export/import step.

### 6. Exact Solver (`exact_solver.py`, `solver_rs/`)

MCTS and human players both produce only *upper* bounds; the `rank <= 4`
induction above is as far as optimality can be established by playing. The exact
solver closes that gap for small shapes by exhaustive treedepth recursion over
bitboards:

```text
rank(disconnected) = max over components          (separator theorem)
rank(connected)    = 1 + min over v of rank(G - v)
```

Results are provable, so they are written via `upsert_exact_solution` with
`is_optimal = True`. That converts those shapes into **hard MCTS cutoffs**
instead of mere value clamps, and gives the game's magic wand a guaranteed-best
solution. Where the proven optimum beats the stored rank, the entry is corrected
— on the current tablebase this affected a substantial fraction of mid-size
shapes, i.e. the solver repairs data as much as it certifies it.

- **Two interchangeable backends.** `exact_solver.py` contains the reference
  implementation in pure Python; `solver_rs/` is a dependency-free Rust binary
  running the same algorithm ~130x faster. `--backend auto` (the default) uses
  the binary when it has been built and falls back to Python otherwise, so
  **Rust is optional** — no cargo toolchain is required to use the project.
- **Verification.** Both backends are checked against the base cases from
  `docs/Problem_Description.md` on every run, and every produced cut sequence is
  replayed by `replay_rank` (mirroring `core_engine.replay_engine` semantics)
  before it may be written. The Rust binary is never trusted blindly.
- **Boundary.** The binary neither hashes nor touches the database; it consumes
  `shape_str` and returns ranks over a TSV protocol (see `solver_rs/README.md`).
  `core_engine.hashing` therefore remains the single source of truth for
  canonical hashing, with no second implementation that could drift.
- **Reach.** Cost is exponential in shape size. Shapes whose bounding box
  exceeds a 128-bit board fall back to the Python implementation. Large
  intermediate shapes (roughly 27+ cells) remain out of reach in either backend
  — but they also recur too rarely to be worth much as tablebase entries.

### 6. Value Grounding

The value head is never trained on its own predictions. Every state in a finished episode is labelled `intrinsic_rank = total_rank - cuts_at_state`, where `total_rank` is derived from real terminal states (a fully dissolved graph's rank *is* its cut count) and verified tablebase entries. Two hard bounds clamp raw network output before MCTS uses it:

- `max(nn_val, 4.0)` for shapes absent from the tablebase — anything of rank $\le 3$ would already be recorded there, so the true rank must be at least 4.
- `min(nn_val, best_rank)` for known but not-proven-optimal shapes — a recorded solution is a valid upper bound.
