# AlphaWolf RL Architecture

> **Audience:** Future contributors and AI agents working on the HOWL reinforcement learning engine.

## Overview

AlphaWolf is the Reinforcement Learning (RL) pipeline for HOWL, designed to compute minimal graph separators for the vertex $k$-ranking problem autonomously. It heavily draws inspiration from the AlphaZero architecture, employing a combination of Monte Carlo Tree Search (MCTS), a policy-value neural network, and self-play.

Unlike standard game engines, AlphaWolf is integrated with a globally shared tablebase containing community-discovered optimal shapes, allowing it to efficiently prune branches and bootstrap its learning.

## Tech Stack

- **Framework**: PyTorch
- **Environment**: Custom simulation wrapped similarly to OpenAI Gym (`envs/howl_env.py`)
- **Core Logic**: Interfaces with `core_engine` for grid graph manipulation and hashing
- **Data Persistence**: `db/tablebase.py` for reading/writing known ranks to the backend database

---

## Data Flow & Training Pipeline

```text
┌────────────────────────────────────────────────────────┐
│                      MCTS (Self-Play)                  │
│  1. Expand nodes using Neural Network priors           │
│  2. Prune optimal shapes using Tablebase Lookups       │
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
- Discovered sub-sequences and final optimal grid solutions are upserted to the database, ensuring the community UI and future RL generations benefit from the run.

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
- **`query_tablebase`**: Checks if the canonical hashes of current board shapes have known optimal solutions. If `is_optimal` is true, or the rank is extremely small ($\le 3$), MCTS stops exploring that subgraph and uses the value.
- **`upsert_subgraph`** / **`upsert_grid_solution`**: Records new discoveries so the React frontend can automatically display Magic Wands and Abacuses for humans who encounter those same states.
