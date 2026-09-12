# HOWL - Hyper Optimizing Wolf's Logic

> 🎮 **Live Web App:** [https://howl-lovat.vercel.app/?access=howl-guest](https://howl-lovat.vercel.app/?access=howl-guest) *(1-Click Instant Guest Access)*

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
howl/
├── alphawolf/                # AlphaZero Reinforcement Learning pipeline
│   ├── envs/                 # Gymnasium environments for grid graphs
│   ├── models/               # PyTorch GNN policy & value architectures
│   ├── db/                   # Tablebase interface & replay gatekeeper
│   ├── tests/                # MCTS, GNN, math invariant, and pipeline tests
│   ├── train.py              # Main training loop with curriculum learning
│   └── benchmark.py          # Model evaluation gauntlet & Elo tracking
│
├── backend/                  # FastAPI web server & database layer
│   ├── routes/               # REST endpoints (auth, gameplay, leaderboards)
│   ├── services/             # Application services & Discord webhook
│   ├── tests/                # API integration & security tests
│   └── database.py           # SQLite / PostgreSQL connection & ORM models
│
├── core_engine/              # Shared pure-Python graph algorithms package
│   ├── graph_logic.py        # Tarjan articulation points & component decomposition
│   ├── hashing.py            # D₄ dihedral group canonical symmetry hashing
│   └── replay_engine.py      # Move sequence validation & elimination tree
│
├── frontend/                 # React + PixiJS WebGL web client
│   └── src/
│       ├── components/       # Game canvas, matrix leaderboard, UI modals
│       ├── pages/            # Top-level routes (Game, Leaderboard, Replay, Docs)
│       ├── state/            # Redux Toolkit slices (gameSlice, settingsSlice)
│       └── styles/           # Theme CSS variables & responsive layout
│
└── docs/                     # Mathematical background, research papers & screenshots
```

## Setup & Run

The project uses a single shared Python virtual environment (`backend/venv`) for all Python components (`backend`, `alphawolf`, and the editable `core_engine` package).

### 1. Frontend (React / PixiJS)

```bash
cd frontend
npm install
npm run dev
```
Runs on `http://localhost:5173` by default (Vite).

### 2. Python Environment Setup (Shared for Backend & AlphaWolf)

#### macOS / Linux / WSL
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install -r ../alphawolf/requirements.txt
```

#### Windows (PowerShell)
```powershell
cd backend
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -r ..\alphawolf\requirements.txt
```
> **Tip for PowerShell:** If you receive an execution policy error, enable scripts for the current terminal session:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process`

#### Windows (Command Prompt `cmd.exe`)
```cmd
cd backend
python -m venv venv
venv\Scripts\activate.bat
pip install -r requirements.txt
pip install -r ..\alphawolf\requirements.txt
```

### 3. Run Backend Server (FastAPI)

With the virtual environment activated:
```bash
# From the backend/ directory:
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
Runs on `http://127.0.0.1:8000` by default (Swagger API docs at `http://127.0.0.1:8000/docs`).

### 4. Run AlphaWolf (RL Engine & CLI Tools)

With the virtual environment activated (`source backend/venv/bin/activate` on Unix or `.\backend\venv\Scripts\Activate.ps1` on Windows):

```bash
cd alphawolf

# 1. Query the database & 10x10 rank matrix:
python query_db.py

# 2. Run high-simulation (1000 MCTS) rollouts to solve a specific grid:
python eval.py

# 3. Start a FRESH training run with Hybrid Curriculum (Default: 4x4 -> 9x9 staged mastery):
python train.py

# 4. Choose specific Curriculum Mode (hybrid, staged, linear, or uniform):
python train.py --curriculum hybrid
python train.py --curriculum linear
python train.py --no-curriculum

# 5. RESUME training from the latest checkpoint (e.g. alphawolf_gen_25.pt -> Gen 26):
python train.py --resume

# 6. Resume from best benchmark baseline or a specific file:
python train.py --resume best
python train.py --resume models/checkpoints/alphawolf_gen_15.pt

# 7. Override training hyperparameters on the fly:
python train.py --generations 50 --games-per-gen 20 --sims 400 --workers 6
```

## Running Tests

Once your virtual environment is activated, run tests directly with `pytest`:

### Fast AlphaWolf Math & Unit Tests (~5–8s)
Verifies $D_4$ hashing, Tarjan cut vertex detection, replay gatekeeper validation, MCTS virtual loss, and GNN message passing:
```bash
# macOS / Linux / WSL:
pytest alphawolf/tests/ -k "not test_alpha_zero_1_generation_dry_run" -v

# Windows (PowerShell):
pytest alphawolf\tests\ -k "not test_alpha_zero_1_generation_dry_run" -v
```

### Full AlphaWolf Test Suite (including 1-gen training dry run)
```bash
# macOS / Linux / WSL:
pytest alphawolf/tests/ -v

# Windows (PowerShell):
pytest alphawolf\tests\ -v
```

### Backend & API Tests
Runs hashing, replay engine, and FastAPI endpoint tests:
```bash
# macOS / Linux / WSL:
pytest backend/tests/ -v

# Windows (PowerShell):
pytest backend\tests\ -v
```

### Run All Tests
```bash
# macOS / Linux / WSL:
pytest alphawolf/tests/ backend/tests/ -v

# Windows (PowerShell):
pytest alphawolf\tests\ backend\tests\ -v
```

*(Note: If running without activating the virtualenv first, use `backend/venv/bin/pytest` on Unix or `.\backend\venv\Scripts\pytest.exe` on Windows)*

## Deployment

The project is designed to be deployed across two separate services:
- **Frontend**: Deployed as a static Vite/React application (e.g. on Vercel). Expects a `VITE_API_URL` environment variable pointing to the backend.
- **Backend**: Deployed running FastAPI (e.g. on Render) with a persistent volume or PostgreSQL database. Requires an `AUTH_SECRET` environment variable for administrative gatekeeping, and optionally `GUEST_SECRET` (defaults to `howl-guest`) for visitor access.

## Architecture

See [`alphawolf/ARCHITECTURE.md`](alphawolf/ARCHITECTURE.md) for a deep dive into the Reinforcement Learning pipeline, MCTS search, model benchmarking, and mathematical verification tests.

See [`backend/ARCHITECTURE.md`](backend/ARCHITECTURE.md) for a detailed technical overview of the backend server and its interactions with the shared core engine.

See [`frontend/ARCHITECTURE.md`](frontend/ARCHITECTURE.md) for details on the React/PixiJS rendering loop, Redux state management, and mobile-responsive layout.
