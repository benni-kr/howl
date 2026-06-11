# HOWL Backend Architecture

> **Audience:** Future contributors and AI agents working on the HOWL backend codebase.

## Overview

The HOWL backend is a Fast/API Python server that powers the crowdsourced mathematics graph-theory game. It validates game state, computes theoretical lower bounds, processes cut sequence DTOs to extract vertex rankings, and manages the global SQLite data persistence.

The backend is modularized into clearly separated layers:
- `main.py` / `routes/`: FastAPI endpoints and lifespan management.
- `core_engine/`: Shared, pure-python business logic package (graph calculations, hashing).
- `services/`: Database interface services and session management.
- `database.py` / `models.py` / `schemas.py`: SQLAlchemy setup, ORM classes, and Pydantic DTOs.

The backend has two primary persistence tables:

| Table               | Purpose                                             |
|---------------------|-----------------------------------------------------|
| `grid_solutions`    | Best-known rank per (m, n, solver_name) triple      |
| `subgraph_dictionary` | Canonical hash → best known rank for *any* shape  |

---

## Data Flow

```text
┌──────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React)                           │
│                                                                     │
│  1. Player makes cuts / batch actions (vaporizes) on the grid       │
│  2. Cuts recorded in Redux: cutsApplied[]                           │
│  3. After each cut, POST /api/game/check_shapes polls the backend   │
│  4. If match exists, frontend displays Magic Wand/Abacus icons      │
│  5. On victory, submit cutsApplied to POST /api/game/submit_solution│
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      BACKEND (FastAPI + SQLite)                     │
│                                                                     │
│  POST /api/game/submit_solution                                     │
│    1. Parse Compact DTO and normalize coordinate format             │
│    2. Replay cut_sequence on a fresh m×n grid (Replay Engine)       │
│    3. Build an Elimination Tree of intermediate subgraphs           │
│    4. Calculate intrinsic rank for each subgraph (bottom-up)        │
│    5. Check mathematical perfection via theoretical lower bounds    │
│    6. Upsert each (canonical_hash, rank) into subgraph_dictionary   │
│    7. Upsert the GridSolution (if rank is globally optimal)         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## The Replay Engine (`core_engine/replay_engine.py`)

### Purpose

When a player wins, the frontend sends a flat log of actions (`cutsApplied`). The backend replays this log on a fresh $m \times n$ grid to reconstruct the exact tree of intermediate subgraphs. This tree is then scored bottom-up.

### Input: `cut_sequence` (DTO Pattern)

To save bandwidth and storage, the frontend submits a highly compact JSON payload.

```python
# Compact DTO Format (frontend sends this):
[
    {"t": "c", "v": [[0, 0], [0, 1]]},          # t="c" -> "cut"
    {"t": "v", "v": [[2, 0]], "r": 1},          # t="v" -> "vaporize"
    {"t": "i", "v": [[3, 3]]}                   # t="i" -> "ignore/duplicate"
]
```
The internal engine normalizes the flat `[x, y]` coordinates into `list[tuple[int, int]]` for processing.

### Tree Construction

```
replay_and_extract_subgraphs(m, n, cut_sequence):
    root = TreeNode(GridGraph(m, n))
    active_nodes = [root]

    for each action in cut_sequence:
        if action is "vaporize" or "ignore":
            find matching active node by canonical hash (fallback: vertex probe)
            mark it with vaporized_rank (or solved)
            remove from active_nodes

        if action is "cut":
            find the active node containing ALL cut vertices
            remove cut vertices from the node's graph
            get disconnected subgraphs
            create child TreeNodes, add to active_nodes
```

### Subgraph Detection (Connected Components)
When an action instructs the engine to "cut" vertices, the graph fragments. The engine uses a **Breadth-First Search (BFS)** algorithm (`_bfs_component` in `core_engine/graph_logic.py`) traversing the 4-way grid adjacencies of the remaining un-cut vertices to identify all distinct connected components. Each component is then isolated, instantiated as a new `GridGraph`, and appended to the tree as a child node.

### Target Matching & Batch Actions
- **Cut (`c`)**: Match by checking that ALL cut vertices are a subset of the node's vertex set (`cut_set.issubset(node.graph.vertices)`).
- **Vaporize (`v`)**: Match by canonical hash first (rotation/reflection invariant). Falls back to a single-vertex probe for edge cases. Short-circuits recursion and marks node with `optimal_rank`.
- **Ignore / Vaporize Duplicate (`i`)**: Matches identically to Vaporize, but inherently asserts the node has a sibling or superset already handling the bounding limits. Marks node as "solved".

### Strict Validation Guard
The engine enforces **strict subset validation** during replay. If any target nodes in a cut or vaporize action cannot be resolved against the active tree (e.g., due to frontend state lag or phantom nodes), the engine explicitly raises a `ValueError`. This ensures that mathematically invalid run sequences are unconditionally rejected by the backend and never committed to the `subgraph_dictionary`.

### Rank Calculation (Bottom-Up)

```python
rank(leaf with 1 vertex)  = 1
rank(vaporized node)      = vaporized_rank  (from SubgraphDictionary)
rank(cut node)            = cut_size + max(rank(child) for child in children)
rank(unsolved leaf)       = 999999  (sentinel — game wasn't completed)
```

Only entries with `rank < 999999` and non-obliterated nodes are written to the `subgraph_dictionary`. (An obliterated node is one where the cut completely wiped out the entire graph without leaving fragments).

---

## Canonical Hash Algorithm

Every subgraph shape is identified by a **canonical hash** that is invariant under translation, rotation ($0^\circ/90^\circ/180^\circ/270^\circ$), and reflection.

```python
def generate_canonical_hash(vertices):
    # 1. Generate all 8 orientations (4 rotations × 2 reflections)
    # 2. Normalize each to the origin (min_x, min_y) = (0, 0)
    # 3. Sort vertices lexicographically
    # 4. Build string: "x,y|x,y|..."
    # 5. Return the lexicographically smallest string
```
Example: A $2 \times 2$ square at any position always hashes to `"0,0|0,1|1,0|1,1"`.

### ⚠️ Frontend `getLocalGraphFingerprint` ≠ Canonical Hash
The frontend has a helper `getLocalGraphFingerprint(graph)` that builds a position-dependent string from sorted vertices. This is **NOT** a canonical hash — it does not account for rotation or reflection. It is only used as a local `Map<string, number>` key within a single React render cycle to correlate `checkShapes` API results back to their source graphs.

---

## The SubgraphDictionary Lifecycle

1. **Population:** Every `submit_solution` call replays the game and upserts subgraph ranks. This happens regardless of whether the solution is a new record.
2. **Lookup:** The frontend polls `POST /api/game/check_shapes` after every cut. This endpoint computes the canonical hash of each on-screen subgraph and looks it up in the dictionary.
3. **Auto-Solve (Magic Wand):** If a match is found, the frontend displays a Magic Wand icon directly over the subgraph on the PixiJS canvas. Clicking the subgraph dispatches `autoSolveGraph`, which:
   - Records a `vaporize` action in `cutsApplied`
   - Uses the dictionary's `best_rank` as `optimal_rank`
   - The shape is "solved" and removed from the board
4. **Score Computation:** When the vaporized game is submitted, the replay engine encounters the `vaporize` action and uses `optimal_rank` instead of recursing into children.

---

## Theoretical Math Bounds

HOWL leverages known theoretical lower bounds for standard rectangular grids.

Assume $m \le n$:
- **Paths ($m=1$):** $r(1,n) = \lfloor\log_2(n)\rfloor + 1$
- **Ladders ($m=2$):** $r(2,n) = 2 + r(2, \lceil(n - 2) / 2\rceil)$
- **Narrow / Large Grids:** Advanced piecewise boundary formulas.

These theoretical bounds are used on the Leaderboard Matrix to calculate the "Perfection Gap"—the difference between the community's achieved minimum rank and mathematical reality. In the latest architecture, bounds logic is integrated directly into the pre-populated tablebase and queried via canonical hashing, rather than calculated repeatedly at runtime.

---

## Database Schema

### `grid_solutions`

| Column        | Type     | Description                              |
|---------------|----------|------------------------------------------|
| id            | INTEGER  | Primary key                              |
| m             | INTEGER  | Grid width                               |
| n             | INTEGER  | Grid height                              |
| rank          | INTEGER  | Best achieved rank for this solver        |
| solver_name   | TEXT     | Player alias                             |
| cut_sequence  | JSON     | The full action log                      |
| created_at    | DATETIME | Submission timestamp                     |

**Unique constraint:** `(m, n, solver_name)` — one entry per player per grid.

### `subgraph_dictionary`

| Column    | Type    | Description                                    |
|-----------|---------|------------------------------------------------|
| hash      | TEXT    | Canonical hash (primary key)                   |
| best_rank | INTEGER | Best known intrinsic rank for this shape        |
| is_optimal| BOOLEAN | Theoretically optimal flag (reserved for future/leaderboard math) |

---

## Database Sanitization (`scripts/sanitize_db.py`)

A standalone maintenance script is provided to audit the mathematical integrity of the production database. 
- It iteratively replays every `GridSolution` against the latest Replay Engine validation logic.
- It detects "CORRUPT" runs (where a `ValueError` is thrown due to invalid cuts) and "MISMATCH" runs (where the server's intrinsic rank computation differs from the recorded score).
- By default, it operates in a **non-destructive dry-run mode**. Appending the `--destructive` flag allows administrators to permanently purge invalid subgraphs and runs from the active tables.

---

## Authentication & Security

HOWL implements a lightweight, global gatekeeper mechanism:
- The backend uses `.env` variable: `AUTH_SECRET`.
- `POST /api/auth/login` expects `{"username": "admin", "password": "<AUTH_SECRET>"}` and returns the token.
- Write endpoints (`/api/game/submit_solution` and `DELETE /api/leaderboards/solutions/{solution_id}`) require `Authorization: Bearer <token>`.
- Read endpoints are unauthenticated to allow crowdsourced fetching.
