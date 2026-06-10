---
description: Guidelines for working on the Python backend and core math engine.
activation:
  type: glob
  pattern: "backend/**, core_engine/**"
---

# Backend & Core Engine Guidelines

When operating within the `backend/` or `core_engine/` directories, adhere to these constraints:

## 1. Separation of Concerns
- **`core_engine/`**: Must remain completely framework-agnostic. It contains pure Python math, graph representation (`GridGraph`), and canonical hashing logic. **Do not introduce FastAPI, SQLite, or network dependencies here.**
- **`backend/`**: Handles all FastAPI routing, SQLite persistence, and dependency injection. It imports `core_engine` but does not perform raw graph math itself.

## 2. Tablebase Source of Truth
The `subgraph_dictionary` table stores the CURRENT BEST known ranks for shapes. A rank is only guaranteed optimal if the `is_optimal` flag is true. When building new features that evaluate ranks, always check the tablebase first before recursing.

## 3. Database
- We use pure SQLite for simplicity and crowdsourcing speed.
- `howl.db` is the production database; `test.db` is used for pytest logic.
- Always use the provided dependency injection `get_db` for SQLAlchemy sessions in routes.
