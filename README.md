# HOWL - Hyper Optimizing Wolf's Logic

A web-based crowdsourcing game for solving vertex k-ranking problems on grid graphs.

## Project Structure

```
howl-project/
├── backend/                  # Python/FastAPI app + SQLite
│   ├── venv/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── graph_logic.py
│   └── requirements.txt
│
├── frontend/                 # React/Vite app
│   ├── package.json
│   ├── vite.config.ts
│   ├── public/
│   └── src/
│       ├── api/
│       ├── components/
│       ├── state/
│       ├── utils/
│       ├── styles/
│       └── App.tsx
│
├── .gitignore
└── README.md
```

## Setup & Run

### Install & Run Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:3000` by default.

### Install & Run Backend

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Runs on `http://127.0.0.1:8000` by default.

## Features

- **Interactive Grid Visualizer**: PixiJS-based renderer with cut selection, split-view, and animations
- **Custom Grid Sizes**: Create or restart any grid up to 100 × 100
- **Cut Set Management**: Toggle vertices for removal, undo/redo full history
- **Backend Integration**: Send cuts to Python backend for graph decomposition
- **Score Persistence**: Submit global best ranks to SQLite (`grid_solutions` table)
- **Subgraph Dictionary**: Every game replay extracts intermediate shapes and their optimal ranks into a crowdsourced dictionary (`subgraph_dictionary` table)
- **Auto-Solve (Vaporize)**: When a subgraph on the board matches a previously solved shape in the dictionary, players can instantly "vaporize" it using the community's best known solution
- **Leaderboard**: Matrix view of best scores across all grid sizes, per-grid rankings, and top-solver standings
- **Dark Theme UI**: Modern, sleek interface with multiple color palettes

## Architecture

See [`backend/ARCHITECTURE.md`](backend/ARCHITECTURE.md) for a detailed technical overview of:

- The data flow between frontend and backend
- The replay engine and intrinsic rank calculation
- The canonical hash algorithm (rotation/reflection invariant)
- The SubgraphDictionary lifecycle and Auto-Solve mechanic
- Database schema and known limitations
