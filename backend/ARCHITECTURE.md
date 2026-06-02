# HOWL Backend Architecture

> **Audience:** Future contributors and AI agents working on the HOWL codebase.

## Overview

HOWL is a crowdsourcing game for vertex k-ranking on grid graphs. Players cut
vertices from an m×n grid to decompose it into disconnected subgraphs. The
goal is to find the *minimum* rank — the fewest total cuts needed to fully
decompose the grid such that every resulting piece is a single vertex.

The backend has two persistence layers:

| Table               | Purpose                                             |
|---------------------|-----------------------------------------------------|
| `grid_solutions`    | Best-known rank per (m, n, solver_name) triple      |
| `subgraph_dictionary` | Canonical hash → best known rank for *any* shape  |

---

## Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React)                           │
│                                                                     │
│  1. Player cuts vertices on the grid                                │
│  2. Each cut is recorded in Redux: cutsApplied[]                    │
│  3. After each cut, checkShapes() polls the SubgraphDictionary      │
│     to see if any subgraph on the board has a known solution        │
│  4. If a match exists, show "⚡ Auto-Solve" button                  │
│  5. On victory, submit cutsApplied to POST /api/submit_solution     │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      BACKEND (FastAPI + SQLite)                     │
│                                                                     │
│  POST /api/submit_solution                                          │
│    1. Replay cut_sequence on a fresh m×n grid (replay engine)       │
│    2. Build a tree of intermediate subgraphs                        │
│    3. Calculate intrinsic rank for each subgraph (bottom-up)        │
│    4. Upsert each (canonical_hash, rank) into subgraph_dictionary   │
│    5. Upsert the GridSolution (best rank per solver per grid size)  │
│                                                                     │
│  POST /api/check_shapes                                             │
│    For each subgraph: hash it → lookup in subgraph_dictionary       │
│    Returns: { found, best_rank, is_optimal } per shape              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## The Replay Engine (`graph_logic.py`)

### Purpose

When a player wins, the frontend sends a flat log of actions (`cutsApplied`).
The backend replays this log on a fresh m×n grid to reconstruct the *tree* of
every intermediate subgraph. This tree is then scored bottom-up.

### Input: `cut_sequence` (DTO Pattern)

To save bandwidth and storage, the frontend submits a highly compact JSON payload.

```python
# Compact DTO Format (frontend sends this):
[
    {"t": "c", "v": [[0, 0], [0, 1]]},
    {"t": "v", "v": [[2, 0]], "r": 1},
    {"t": "i", "v": [[3, 3]]}
]
```

The `_to_tuples()` helper normalizes the flat `[x, y]` coordinates into `list[tuple[int, int]]` for the replay engine.

### Tree Construction

```
replay_and_extract_subgraphs(m, n, cut_sequence):
    root = TreeNode(GridGraph(m, n))
    active_nodes = [root]

    for each action in cut_sequence:
        if action is "vaporize":
            find matching active node by canonical hash (fallback: vertex probe)
            mark it with vaporized_rank
            remove from active_nodes

        if action is "cut":
            find the active node containing ALL cut vertices
            remove cut vertices from the node's graph
            get disconnected subgraphs
            create child TreeNodes, add to active_nodes
```

### Target Matching

- **Vaporize:** Match by canonical hash first (rotation/reflection invariant).
  Falls back to a single-vertex probe for edge cases.
- **Cut:** Match by checking that ALL cut vertices are a subset of the node's
  vertex set (`cut_set.issubset(node.graph.vertices)`).

### Rank Calculation (Bottom-Up)

```
rank(leaf with 1 vertex)  = 1
rank(vaporized node)      = vaporized_rank  (from SubgraphDictionary)
rank(cut node)            = cut_size + max(rank(child) for child in children)
rank(unsolved leaf)       = 999999  (sentinel — game wasn't completed)
```

Only entries with `rank < 999999` and non-obliterated nodes are written to
the `subgraph_dictionary`.

**Obliterated node:** A node where `cut_size > 0` but `children` is empty —
the cut removed ALL remaining vertices. These are valid (terrible) solutions
but are excluded from the dictionary because they don't teach us anything
useful about the shape.

---

## Canonical Hash Algorithm

Every subgraph shape is identified by a **canonical hash** that is invariant
under translation, rotation (0°/90°/180°/270°), and reflection.

```python
def generate_canonical_hash(vertices):
    # 1. Generate all 8 orientations (4 rotations × 2 reflections)
    # 2. Normalize each to the origin (min_x, min_y) = (0, 0)
    # 3. Sort vertices lexicographically
    # 4. Build string: "x,y|x,y|..."
    # 5. Return the lexicographically smallest string
```

Example: A 2×2 square at any position/rotation always hashes to `"0,0|0,1|1,0|1,1"`.

### ⚠️ Frontend `getLocalGraphFingerprint` ≠ Canonical Hash

The frontend has a helper `getLocalGraphFingerprint(graph)` that builds a
position-dependent string from sorted vertices. This is **NOT** a canonical
hash — it does not account for rotation or reflection. It is only used as a
local `Map<string, number>` key within a single React render cycle to
correlate `checkShapes` API results back to their source graphs.

---

## The SubgraphDictionary Lifecycle

1. **Population:** Every `submit_solution` call replays the game and upserts
   subgraph ranks. This happens regardless of whether the solution is a new
   record.

2. **Lookup:** The frontend polls `POST /api/check_shapes` after every cut.
   This endpoint computes the canonical hash of each on-screen subgraph and
   looks it up in the dictionary.

3. **Auto-Solve (Magic Wand):** If a match is found, the frontend displays a Magic Wand icon directly over the subgraph on the PixiJS canvas. Clicking the subgraph dispatches `autoSolveGraph`, which:
   - Records a `vaporize` action in `cutsApplied`
   - Uses the dictionary's `best_rank` as `optimal_rank`
   - The shape is "solved" and removed from the board without the player having to cut it

4. **Score Computation:** When the vaporized game is submitted, the replay
   engine encounters the `vaporize` action and uses `optimal_rank` instead of
   recursing into children.

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
| is_optimal| BOOLEAN | Reserved for future use (always false for now)  |

---

## Authentication

HOWL implements a lightweight, global gatekeeper mechanism to prevent unauthorized spam/writes to the database:
- The backend relies on a single `.env` variable: `AUTH_SECRET`.
- The `POST /api/auth/login` endpoint expects `{"username": "admin", "password": "<AUTH_SECRET>"}`.
- If successful, the backend simply returns the `AUTH_SECRET` as a bearer token.
- Write endpoints (`/api/submit_solution` and `/api/delete_solution`) require this token in the `Authorization: Bearer <token>` header. Read endpoints (like checking shapes or fetching leaderboards) are unauthenticated.

---

## Known Limitations

1. **Single-threaded SQLite:** The backend uses SQLite with
   `check_same_thread=False`. Under high concurrency, `IntegrityError` is
   caught and handled, but the database is not designed for heavy write loads.

2. **Replay is synchronous:** Large grids with many cuts may take noticeable
   time to replay. Consider backgrounding the replay for grids > 20×20.

3. **`is_optimal` is always false:** The `SubgraphDictionary.is_optimal` flag
   is reserved for a future feature where we can mathematically prove a rank
   is optimal. Currently unused.
