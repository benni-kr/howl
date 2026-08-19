# AlphaWolf RL Architecture

> **Audience:** Future contributors and AI agents working on the HOWL reinforcement learning engine.

## Overview

AlphaWolf is the Reinforcement Learning (RL) pipeline for HOWL, designed to compute minimal graph separators for the vertex $k$-ranking problem autonomously. It heavily draws inspiration from the AlphaZero architecture, employing a combination of Monte Carlo Tree Search (MCTS), a policy-value neural network, and self-play.

Unlike standard game engines, AlphaWolf is integrated with a globally shared tablebase containing community-discovered best known shapes, allowing it to efficiently prune branches and bootstrap its learning.

## Tech Stack

- **Framework**: PyTorch, plus PyTorch Geometric (`torch_geometric`) for the graph network
- **Environment**: Custom simulation wrapped similarly to OpenAI Gym (`envs/howl_env.py`)
- **Core Logic**: Interfaces with `core_engine` for grid graph manipulation and hashing
- **Data Persistence**: `db/tablebase.py` for reading/writing known ranks to the backend database


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

The main training orchestrator runs generations of self-play, network training, and benchmark promotion. Each generation samples `games_per_generation` boards with independently random dimensions in $[4, 9]$, spread across `num_workers` processes via `ProcessPoolExecutor`.

> **Note:** self-play sizes are sampled uniformly (`self_play_min_grid`..`self_play_max_grid` in `config.json`) — there is currently no curriculum. The former `unlocked_tiers` parameter was dead code (uniform sampling replaced it in `0736757`) and has been removed; a real curriculum with a lower-bound unlock criterion is planned (see `ROADMAP.md`, C2).

Training starts from **randomly initialised weights every run** — `alpha_zero_loop` does not load `best_model.pt`. The existing checkpoint serves only as the benchmark baseline; there is no resume path.

During self-play:
- Each MCTS simulation explores possible cuts, guided by the neural network's policy and value heads.
- When an action shatters the graph into subgraphs, AlphaWolf evaluates each fragment. If a fragment is found in the `tablebase`, it immediately returns its known rank, halting the MCTS branch for that fragment.
- Discovered sub-sequences and final best known grid solutions are upserted to the database, ensuring the community UI and future RL generations benefit from the run.

### 1a. MCTS Leaf Batching

`mcts_search` collects up to `mcts_batch_size` leaves per round under a **virtual loss** (each in-flight simulation temporarily makes its path look `VIRTUAL_LOSS_PENALTY` ranks worse, so concurrently collected simulations diverge), evaluates all leaf and fragment states in a single forward pass, then lifts the virtual loss and backpropagates the true values.

`mcts_batch_size=1` reproduces the original sequential search exactly. Measured on the $\le 7\times7$ gauntlet, batching trades roughly 4% cumulative rank for ~35% wall-clock speed — so self-play uses 8 (config `mcts_batch_size`) while `benchmark.py` and `eval.py` pin 1, where solution quality is the deliverable.

### 2. Neural Network (`models/net.py`)

`AlphaWolfNet` is an **alias for `AlphaWolfGNN`** (since `08d466f`). The dense observation is converted to a sparse graph by `grid_tensor_to_pyg_data`, then processed by message passing:

```text
SAGEConv(4 -> 128) + ReLU
  6x [ SAGEConv(128 -> 128) + ReLU + skip connection ]
    |
    +-- Policy Head: Linear(128->128) -> ReLU -> Linear(128->1)
    |   One logit per node, scattered back to the fixed 100-dim action
    |   space; inactive positions filled with -1e9 before softmax.
    |
    +-- Value Head: global_mean_pool -> Linear(128->128) -> ReLU -> Linear(128->1)
        Estimates the expected intrinsic rank of the current state.
```

Roughly 232k parameters. `AlphaWolfCNN` and `ResBlock` remain in the file as the archived v1.1 architecture; `best_model_v1_1.pt` still loads into it. The five `best_model_{5x5..7x7}.pt` checkpoints predate both and load into **neither** class.

**On $D_4$ symmetry:** this network is structurally invariant to rotation and reflection — its node features (degree, border, component id, articulation point) contain no coordinates, so a rotated board is an isomorphic graph producing bit-identical outputs. Replay buffer augmentation is therefore *not* applied and would add no information. This differs from the archived CNN, where augmentation was essential. Canonical $D_4$ hashing for tablebase lookups remains mandatory and unaffected.

### 2a. Value Grounding

The value head is never trained on its own predictions. Every state in a finished episode is labelled `intrinsic_rank = total_rank - cuts_at_state`, where `total_rank` is derived from real terminal states (a fully dissolved graph's rank *is* its cut count) and verified tablebase entries. Two hard bounds clamp raw network output before MCTS uses it:

- `max(nn_val, 4.0)` for shapes absent from the tablebase — anything of rank $\le 3$ would already be recorded there, so the true rank must be at least 4.
- `min(nn_val, best_rank)` for known but not-proven-optimal shapes — a recorded solution is a valid upper bound.

### 3. Environment (`envs/howl_env.py`)

`HowlEnv` is a custom RL environment built around `core_engine.GridGraph`.

- **State**: A $5 \times 10 \times 10$ float feature map, zero-padded so one network serves every grid size:

  | Channel | Contents |
  |---|---|
  | 0 | Binary mask — active vertex |
  | 1 | Degree / 4 |
  | 2 | Border mask (degree < 4) |
  | 3 | Component id (normalised) |
  | 4 | Articulation points |

  Channel 4 is computed by a single iterative Tarjan pass, $O(V+E)$. It hands the network the vertices whose removal disconnects the graph, so the network only has to judge whether cutting there is *worthwhile*. Note it is all-zero on an intact grid and only becomes informative once the board is fragmented.

- **Action Space**: Flat indexing mapped to 2D coordinates (`action // 10`, `action % 10`).
- **Step Function**: Takes an action, modifies the graph, recalculates subgraphs (using `get_disconnected_subgraphs()`), applies mirror/subset vaporization via `filter_and_deduplicate`, and returns the next observation. The episode terminates when the graph fractures into more than one unique fragment (an AND-node) or is fully obliterated.
- **Construction**: `HowlEnv(m, n, generate=False)` skips grid generation for callers that attach a graph directly (fragment evaluation, cloning from an observation).

### 4. Benchmarking (`benchmark.py`)

To ensure monotonic improvement, AlphaWolf uses an automated gauntlet:
- **The Gauntlet**: A reproducible set of test boards (seeded `random.Random(42)`) consisting of clean rectangles and asymmetrically fractured grids (simulating complex mid-game states), covering $4\times4$ through $9\times9$.
- **Promotion Logic**: A challenger model is promoted to `best_model.pt` only if it discovers a strictly lower total rank across the gauntlet, or matches the rank while requiring fewer MCTS node expansions (indicating stronger intuition and higher confidence).
- **Search mode**: `evaluate_model` defaults to `mcts_batch_size=1` so the benchmark always measures the exact sequential search, independent of whatever self-play uses.

Never overwrite `best_model.pt` by hand — promotion is the only sanctioned path.

### 5. Tablebase Integration (`db/tablebase.py`)

This module connects AlphaWolf directly to the shared backend database (`howl.db` / `test.db`).
- **`query_tablebase`**: Checks if the canonical hashes of current board shapes have known best solutions. If `is_optimal` is true, or the rank is extremely small ($\le 3$), MCTS stops exploring that subgraph and uses the value.
- **`upsert_subgraph`** / **`upsert_grid_solution`**: Records new discoveries so the React frontend can automatically display Magic Wands and Abacuses for humans who encounter those same states. Both only ever improve an entry (`best_rank <` guard), so a bad run cannot degrade a better human solution. `upsert_subgraph` sets `is_optimal` by the `best_rank <= 4` induction: everything of rank $\le 3$ is in the seed, so a shape absent from it has rank $\ge 4$, and a solution achieving 4 is therefore exact. This is the only optimality any *playing* agent can establish.
- **Caching**: lookups are served from a per-process cache over a persistent SQLite connection. The connection is PID-guarded so forked self-play workers open their own; positive hits are kept indefinitely (a best-known rank stays a valid upper bound), while the miss set is cleared on every local upsert. Discoveries made concurrently by *other* processes may be missed until then, which only means falling back to network evaluation — never an unsound result.

This module uses raw `sqlite3` and can therefore only ever address a **local file**. It cannot write to the production Postgres/Supabase database; pointing `DATABASE_URL` at a Postgres URL would make it try to open a file by that name. Getting AlphaWolf discoveries into production requires a deliberate export/import step.
