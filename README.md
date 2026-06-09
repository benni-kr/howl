# HOWL - Hyper Optimizing Wolf's Logic

A highly responsive, web-based crowdsourcing game designed to solve the vertex $k$-ranking problem on grid graphs. By disguising rigorous mathematical bounding as a spatial puzzle, HOWL lets humans use their innate pattern recognition to contribute to open graph theory research.

<div align="center">
  <img src="docs/images/gameplay.png" alt="Gameplay Screenshot" width="600" />
</div>

## Features

- **Interactive Grid Visualizer**: High-performance PixiJS-based WebGL renderer featuring cut selection, split-view pane layouts, and responsive dynamic resizing.
- **Custom Grid Sizes**: Create or restart any grid up to $100 \times 100$.
- **Cut Set Management**: Toggle vertices for removal and explore permutations with full undo/redo history.
- **Batch Actions**: Automatically vaporize identical subgraphs, ignore subgraphs that fit entirely within others, or instantly auto-solve board states that are mathematically proven to be perfect (The Abacus).
- **The Magic Wand**: Encounter a shape the community has already solved? Click the magic wand icon to instantly "vaporize" it using the best known solution from our database.
- **Game Replays**: A full VCR-style replay engine. Watch community solutions, step through cut-by-cut, and observe the dynamic elimination tree construct the rank. Fork any replay to branch off and find a better score.
- **Leaderboard Matrix**: A robust matrix view of best scores across all grid sizes, including perfection gap analytics, linear density scaling, and top-solver standings.
- **Theming & Palettes**: Personalize your puzzle experience with customizable block color palettes and full light/dark mode support.

<div align="center">
  <img src="docs/images/leaderboard.png" alt="Leaderboard Screenshot" width="400" />
</div>

## Project Structure

```text
howl-project/
├── backend/                  # Python/FastAPI app + SQLite
│   ├── venv/                 # Virtual environment
│   ├── main.py               # FastAPI entry point & lifespan events
│   ├── routes/               # API routers (auth, game, leaderboards)
│   ├── services/             # Application services
│   ├── core/                 # Business logic (graph_logic, math_bounds, security)
│   ├── database.py           # SQLite connection & session configuration
│   ├── models.py             # SQLAlchemy ORM models
│   ├── schemas.py            # Pydantic validation schemas
│   ├── requirements.txt      # Python dependencies
│   ├── .env                  # Backend environment variables
│   └── ARCHITECTURE.md       # Backend architecture documentation
│
├── frontend/                 # React/Vite app
│   ├── package.json          
│   ├── vite.config.ts        
│   ├── ARCHITECTURE.md       # Frontend architecture documentation
│   └── src/                  
│       ├── api/              # API wrapper functions and DTO compaction
│       ├── assets/           # Static images and SVGs
│       ├── components/       # UI components divided by feature (layout, ui, game-page, leaderboard-page, etc.)
│       ├── hooks/            # Custom React hooks (e.g., useAlias, useReplayEngine, useGraphLogic)
│       ├── pages/            # Top-level route components (Game, Leaderboard, Login, Replay, Settings, Docs)
│       ├── state/            # Redux Toolkit slices (gameSlice, settingsSlice) and store
│       ├── styles/           # Vanilla CSS stylesheets with CSS variable theming
│       ├── utils/            # Math, hashing, and graph utility functions
│       ├── App.tsx           # React Router setup
│       └── main.tsx          # React DOM entry point
│
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

Runs on `http://localhost:5173` by default (Vite).

### Install & Run Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Runs on `http://127.0.0.1:8000` by default.

## Deployment

The project is designed to be deployed across two separate services:
- **Frontend**: Deployed as a static Vite/React application. Expects a `VITE_API_URL` environment variable pointing to the backend.
- **Backend**: Deployed running FastAPI with a persistent volume for the `howl.db` SQLite database. Requires an `AUTH_SECRET` environment variable for administrative gatekeeping.

## Architecture

See [`backend/ARCHITECTURE.md`](backend/ARCHITECTURE.md) for a detailed technical overview of the backend replay engine, theoretical mathematical bounds, and canonical hashing logic.

See [`frontend/ARCHITECTURE.md`](frontend/ARCHITECTURE.md) for details on the React/PixiJS rendering loop, Redux state management, and mobile-responsive layout.
