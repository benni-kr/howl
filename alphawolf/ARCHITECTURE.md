# AlphaWolf RL Architecture (v2.2)

> **Audience:** Future contributors, researchers, and AI agents working on the HOWL reinforcement learning engine.

---

## Overview

**AlphaWolf** is the Reinforcement Learning (RL) engine for HOWL, designed to discover optimal vertex $k$-rankings (minimal graph separators and tree-depth decompositions) on arbitrary grid graphs autonomously. Built on the principles of AlphaZero, AlphaWolf combines **Monte Carlo Tree Search (MCTS)**, a **size-agnostic Graph Neural Network (GNN)**, and **asynchronous distributed self-play**.

Unlike standard game engines, AlphaWolf is integrated with a globally shared, canonical $D_4$-symmetric tablebase. This allows the search to prune known subgraphs inductively, ensuring that the neural network focuses exclusively on unexplored global graph bisections.

---

## Tech Stack & Core Dependencies

- **Graph Neural Network**: PyTorch + PyTorch Geometric (`torch_geometric`)
- **Environment**: Custom gym-like simulation wrapped around `core_engine.GridGraph` (`alphawolf/envs/howl_env.py`)
- **Core Engine & Hashing**: `core_engine/graph_logic.py`, `core_engine/hashing.py`, `core_engine/replay_engine.py`
- **Data Persistence**: `db/tablebase.py` for reading/writing discoveries to the backend SQLite database (`backend/howl.db`)
- **Parallel Computing**: Multi-process worker pool via `multiprocessing` with `spawn` context and PyTorch GPU batching.

---

## Data Flow & Training Pipeline

```text
┌────────────────────────────────────────────────────────┐
│               Asynchronous Self-Play (MCTS)            │
│  1. Expand legal perimeter nodes using GNN priors      │
│  2. Prune known inductive shapes via Tablebase Lookups │
│  3. Segmented leaf batching with virtual loss penalty  │
│  4. Collect size-agnostic node policies (pi) and Z     │
└──────────────────────────┬─────────────────────────────┘
                           │ Dynamic Graph Trajectories
                           ▼
┌────────────────────────────────────────────────────────┐
│            Rolling Replay Buffer (60k Samples)         │
│  Stores variable-sized PyG Data objects with aligned   │
│  node_pi tensors and intrinsic rank targets.           │
└──────────────────────────┬─────────────────────────────┘
                           │ Batched Variable-Sized Subgraphs
                           ▼
┌────────────────────────────────────────────────────────┐
│            AlphaWolf GNN (Size-Agnostic)               │
│  Trained via Segmented Cross-Entropy (Policy Head)     │
│  and Mean Squared Error (Value Head).                  │
└──────────────────────────┬─────────────────────────────┘
                           │ Candidate Checkpoint Weights
                           ▼
┌────────────────────────────────────────────────────────┐
│         Dynamic Scaled Gauntlet Arena (Benchmark)      │
│  Evaluates candidate model vs baseline on 60 boards    │
│  (4x4 to 15x15+). Promotes if cumulative rank drops.   │
└────────────────────────────────────────────────────────┘
```

---

## Core Architectural Components

### 1. Size-Agnostic GNN & Node-Level Policy (`models/net.py`)

AlphaWolf operates on variable-sized graphs without fixed-canvas or zero-padding constraints:

```text
Input: PyG Data (V nodes, 8 features, 2*E edges)
  │
  ├─► SAGEConv(8 -> 128) + ReLU
  │     6x [ SAGEConv(128 -> 128) + LayerNorm + ReLU + Residual Skip ]
  │
  ├───► Policy Head: Linear(128 -> 128) -> ReLU -> Linear(128 -> 1)
  │       Outputs raw scalar logit per vertex.
  │       Masked with -1e9 for non-perimeter nodes.
  │       Segmented Softmax per graph: torch_geometric.utils.softmax(logits, batch)
  │
  └───► Value Head: global_mean_pool(X, batch) -> Linear(128 -> 128) -> ReLU -> Linear(128 -> 1)
          Estimates expected intrinsic rank of the remaining graph component.
```

- **Parameter Count**: ~235,000 parameters.
- **Complexity**: $O(|V| + |E|)$ time and memory per forward pass (evaluates 10,000 nodes in $<3$ ms on GPU).
- **Segmented Loss Formulation**:
  $$\mathcal{L}_{\text{policy}} = -\frac{1}{B} \sum_{i \in \text{Batch}} \pi_i \log(\text{softmax}(p_i))$$
  $$\mathcal{L}_{\text{value}} = \frac{1}{B} \sum_{k=1}^B (v_k - z_k)^2$$
  $$\mathcal{L}_{\text{total}} = \mathcal{L}_{\text{policy}} + 0.5 \cdot \mathcal{L}_{\text{value}}$$

---

### 2. 100% $D_4$-Invariant 9-Channel Features (`envs/howl_env.py`)

To eliminate the need for dataset augmentation and guarantee identical evaluation under rotations, reflections, and translations, the environment computes 9 topological node features:

| Channel | Feature Name | Description & Mathematical Formula |
| :---: | :--- | :--- |
| **0** | `is_active` | Binary presence mask ($1.0$ if vertex exists in component). |
| **1** | `degree_orth_norm` | 4-way orthogonal connectivity: $\text{deg}_{\text{orth}} / 4.0$. |
| **2** | `degree_diag_norm` | 4-way diagonal connectivity: $\text{deg}_{\text{diag}} / 4.0$ (detects corners and staircase steps). |
| **3** | `boundary_depth_norm` | Topological Medial Axis (BFS skeleton depth normalized to $[0, 1]$). |
| **4** | `radial_center_dist` | Continuous Euclidean distance to component center of mass. |
| **5** | `tarjan_split_balance` | Quantitative articulation point balance score: $\frac{|V_C| - 1 - \max_i |S_i|}{\max(|V_C| / 2.0, 1.0)}$. |
| **6** | `cut_frontier_proximity` | Multi-step cut guide: BFS proximity glow ($1.0 / d$) from active cuts made during the current turn. |
| **7** | `aspect_ratio_inv` | Bounding box ratio: $\min(W, H) / \max(W, H)$ broadcast per component. |
| **8** | `component_solidity` | Component density: $|V_C| / (W \cdot H)$ broadcast per component. |

---

### 3. 8-Adjacent Perimeter Hard Action Masking

On large grids ($10\times 10 \dots 15\times 15$), choosing cuts inside dense solid components creates inefficient interior holes. AlphaWolf restricts the legal action space to the **outer boundary and active cut frontiers**:

- **Perimeter Rule**: A vertex $v$ is legal if and only if $\text{deg}_{\text{orth}}(v) < 4$ or $\text{deg}_{\text{diag}}(v) < 4$ or $v$ is adjacent to an active cut in the current turn.
- **Branching Factor Reduction**: Slashes legal actions from $|V| = 225$ down to $\sim 40\text{--}50$ on $15\times 15$ grids ($60\text{--}80\%$ pruning).
- **Masking Pipeline**:
  - Illegal action logits are clamped to $-10^9$ prior to root and in-tree softmax.
  - Dirichlet exploration noise is sampled strictly over the $N_{\text{legal}}$ dimensions.
  - Tree expansions exclusively instantiate legal boundary children.

---

### 4. Asynchronous MCTS Search & Leaf Batching (`train.py`)

- **Coordinate-Keyed Indexing**: Nodes are indexed dynamically by 2D coordinates `(x, y)` rather than flat integer arrays.
- **Segmented Leaf Batching**: Concurrently expands up to `mcts_batch_size=8` leaves using virtual loss penalties (`VIRTUAL_LOSS_PENALTY = 3.0`), combining all leaf graphs into a single `Batch.from_data_list()` GPU forward pass.
- **Value Grounding & Clamping**:
  - Terminal states: $Z = \text{cuts\_made}$.
  - Subgraph Tablebase hits: if a cut fractures the board into known subgraphs, exact tablebase ranks are substituted immediately.
  - Unseen shapes: clamped to $\max(v(s), 4.0)$ because all subgraphs with rank $\le 3$ exist in the base tablebase.

---

### 5. Curriculum Learning & Developmental Scaling (`curriculum.py`, `bounds.py`)

AlphaWolf scales its self-play through 4 developmental stages:
- **Stage 1 (Foundations)**: $4\times 4 \dots 6\times 6$ (Fast-track mastery threshold $\ge 80\%$)
- **Stage 2 (Intermediate Bisection)**: $4\times 4 \dots 9\times 9$
- **Stage 3 (Advanced Bisection)**: $4\times 4 \dots 12\times 12$
- **Stage 4 (Full Scale)**: $4\times 4 \dots 15\times 15+$

**Triangulated Targets**:
$$R_{\text{target}}(m, n) = \min\big(R_{\text{bisect}}(m, n), R_{\text{db}}(m, n)\big)$$
Where $R_{\text{bisect}}(m, n) = \min(m, n) + R_{\text{target}}(\lfloor \max(m, n)/2 \rfloor, \min(m, n))$ is the exact recursive balanced bisection bound.

---

### 6. Dynamic Scaled Gauntlet & Arena Benchmark (`benchmark.py`)

- **Multi-Scale Gauntlet**: Generates 60 deterministic test boards (seeded with `random.Random(42)`) spanning $4\times 4$ all the way to `self_play_max_grid` ($15\times 15+$).
- **50/50 Symmetry Balance**: Exactly 1 clean rectangular board + 1 asymmetrically fractured board per tier (10% to 30% missing vertices).
- **Batched GPU Evaluation**: Evaluates with `mcts_batch_size=8` across 6 worker processes, running the full 60-board gauntlet in $<25$ seconds.
- **Stride & Stage Gating**:
  - `benchmark_interval: 3`: Executes every 3 generations (and at stage transitions / final generation).
  - `benchmark_min_stage: 2`: Begins arena validation starting at Stage 3 ($12\times 12$).

---

### 7. Tablebase Integration & Replay Gatekeeper (`db/tablebase.py`)

- **Authoritative Gatekeeper**: Every game completed in self-play is re-simulated through `core_engine.replay_engine.replay_and_extract_subgraphs`. If the calculated bottom-up rank does not match the claimed rank, the discovery is rejected with zero database writes.
- **Non-Degradation Invariant**: Database entries are updated strictly if $\text{rank}_{\text{new}} < \text{rank}_{\text{db}}$.
- **Community UI Synchronization**: All valid discoveries automatically populate `grid_solutions` and `subgraph_dictionary` in `backend/howl.db`.

---

## Benchmark & Database Record Milestones

As of **Generation 100** (`alphawolf2.2`), AlphaWolf holds **143 total #1 records** in the global database:

| Grid Dimension | Best Known Rank | AlphaWolf Rank | Solver Status |
| :--- | :---: | :---: | :---: |
| **$4\times 4 \dots 9\times 9$** | Optimal | Optimal | **TIED #1 on ALL square boards** |
| **$10\times 10$** | 20 | **20** | **TIED #1 (World Record)** |
| **$11\times 11$** | 22 | **23** | **+1 from record** |
| **$12\times 12$** | 24 | **25** | **+1 from record** |
| **$13\times 13$** | 26 | **27** | **+1 from record** |
| **$14\times 14$** | 29 | **29** | **TIED #1 (World Record)** |
| **$15\times 15$** | 32 | **32** | **TIED #1 (World Record)** |
| **Large Rectangles $\ge 10\times 10$** | — | — | **#1 Record on 18 out of 21 grids** |

---

## Future Scaling Roadmap ($20\times 20 \to 100\times 100+$)

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Spectral & Harmonic Embeddings (20x20 to 30x30)                   │
│  • Normalized harmonic relative coordinates (x/m, y/n) in [-1, 1]          │
│  • Graph Laplacian Fiedler vector channel for global cut awareness         │
├────────────────────────────────────────────────────────────────────────────┤
│ PHASE 2: Macro-Line Actions & Divide-and-Conquer (30x30 to 50x50)          │
│  • 1-step continuous bisection line projection (reducing tree depth 100x)  │
│  • Subgraph isomorphism caching across symmetric quadrants                 │
├────────────────────────────────────────────────────────────────────────────┤
│ PHASE 3: Multiscale Graph Pyramid (100x100 to Infinite)                    │
│  • Algebraic multigrid / super-node coarsening (e.g. 4x4 block pooling)    │
│  • Direct neural bisection heatmap segmentation                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Testing & Verification Suite

AlphaWolf maintains a comprehensive test suite in `alphawolf/tests/`:

- **`test_math_invariants.py`**:
  - $D_4$ dihedral group completeness (8 transformations) and invariance under rotations and reflections.
  - Quantitative Tarjan split-balance scores and BFS cut frontier proximity.
  - Numerical division-by-zero guards on single-node and thin ribbon subgraphs.
  - 8-adjacent perimeter action masking legality.
- **`test_replay_gatekeeper.py`**:
  - Replay gatekeeper acceptance of valid solutions and rejection of corrupted sequences or rank mismatches.
- **`test_concurrency.py`**:
  - Virtual loss zero-leakage invariant ($\sum \text{visits} = N$, `virtual_loss == 0` for all nodes after search).
  - Multi-worker self-play spawn isolation and memory safety.
- **`test_gnn.py`**:
  - Variable-sized graph batching forward/backward passes and node-level policy output shapes.
- **`test_pipeline.py`**:
  - Gauntlet benchmark reproducibility, dynamic scaling, promotion decision trees, and multi-worker evaluation.

```bash
# Run all fast mathematical invariant, concurrency, and pipeline tests
pytest alphawolf/tests/ -k "not test_alpha_zero_1_generation_dry_run" -v

# Full suite including backend tests
pytest alphawolf/tests/ -v
pytest backend/tests/ -v
```
