# HOWL - Hyper Optimizing Wolf's Logic

A web-based crowdsourcing game for solving vertex k-ranking problems on grid graphs.

## Project Structure

```text
howl-project/
├── backend/                  # Python/FastAPI app + SQLite
│   ├── venv/                 # Virtual environment
│   ├── main.py               # FastAPI entry point & routes
│   ├── database.py           # SQLite connection & session
│   ├── models.py             # SQLAlchemy ORM models
│   ├── schemas.py            # Pydantic validation schemas
│   ├── graph_logic.py        # Replay engine & rank calculation
│   ├── requirements.txt      # Python dependencies
│   ├── .env                  # Backend environment variables
│   └── ARCHITECTURE.md       # Backend architecture documentation
│
├── frontend/                 # React/Vite app
│   ├── package.json          
│   ├── vite.config.ts        
│   ├── public/               
│   ├── ARCHITECTURE.md       # Frontend architecture documentation
│   └── src/                  
│       ├── api/              # API wrapper functions
│       ├── assets/           # Static images and SVGs
│       ├── components/       # Reusable UI components
│       ├── hooks/            # Custom React hooks (e.g., useAlias)
│       ├── pages/            # Top-level route components (Game, Leaderboard, Login)
│       ├── state/            # Redux Toolkit slices and store setup
│       ├── styles/           # Vanilla CSS stylesheets
│       ├── utils/            # Math and graph utility functions
│       ├── App.tsx           # React Router setup
│       └── main.tsx          # React DOM entry point
│
├── .gitignore
├── Problem_Description.md    # Mathematical foundation of the game
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
- **Magic Wand (Vaporize)**: When a subgraph on the board matches a previously solved shape in the dictionary, players can instantly "vaporize" it using the community's best known solution by clicking the Magic Wand icon directly on the subgraph
- **Leaderboard**: Matrix view of best scores across all grid sizes, per-grid rankings, and top-solver standings
- **Dark Theme UI**: Modern, sleek, fully responsive interface with mobile support

## Deployment

The project is designed to be deployed across two separate services:
- **Frontend**: Deployed on Vercel as a static Vite/React application. Expects a `VITE_API_URL` environment variable pointing to the backend.
- **Backend**: Deployed on Render (or similar PAAS) running FastAPI. Uses a persistent disk for the `howl.db` SQLite database. Requires an `AUTH_SECRET` environment variable for admin gatekeeping.

## Architecture

See [`backend/ARCHITECTURE.md`](backend/ARCHITECTURE.md) for a detailed technical overview of the backend replay engine, canonical hashing, and intrinsic rank calculation.

See [`frontend/ARCHITECTURE.md`](frontend/ARCHITECTURE.md) for details on the React/PixiJS rendering loop, Redux state management, and mobile-responsive layout.
