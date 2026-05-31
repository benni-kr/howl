# HOWL Frontend Architecture

> **Audience:** Future contributors and AI agents working on the HOWL frontend codebase.

## Overview

The HOWL frontend is a Single Page Application (SPA) built with **React**, **TypeScript**, and **Vite**. It uses **Redux Toolkit** for state management and **PixiJS** for high-performance 2D rendering of the graph puzzles.

## Tech Stack

- **Framework**: React 18
- **Build Tool**: Vite
- **State Management**: Redux Toolkit (RTK)
- **2D Rendering**: PixiJS (`pixi.js`, `@pixi/react`, `pixi-viewport`)
- **Routing**: React Router DOM
- **Styling**: Vanilla CSS (with CSS Grid and Flexbox) + CSS Variables for theming
- **Icons**: React Icons (Lucide/Fa)

---

## State Management (Redux)

The application relies heavily on Redux to manage the complex, highly-nested state of the mathematical graphs. The state is split into slices:

### `gameSlice.ts`
Manages the core gameplay mechanics and graph state.
- **`activeGraph`**: The main graph currently being played on the board.
- **`recentCutGraphs`**: When a cut divides a graph into multiple subgraphs, the largest goes to `activeGraph`, and the rest go here.
- **`bankedGraphs`**: An inventory of unsolved subgraphs that the player can swap in and out of the active slot.
- **`cutsApplied`**: The linear history of actions (cuts and vaporizes) used to serialize the solution for the backend.
- **`history`**: A stack of previous states used to power the robust Undo/Redo mechanic.

### `settingsSlice.ts`
Manages user preferences.
- **`theme`** / **`mode`**: Toggles between light and dark mode color palettes.
- **`alias`**: The player's chosen name for leaderboard submissions.

### `userPreferencesSlice.ts`
Manages the Just-In-Time (JIT) onboarding tutorial state.
- **`tutorialsSeen`**: A record of boolean flags indicating which contextual tooltips the user has already seen.
- **`activeTooltip`**: The key of the currently active tooltip.

**Available Tooltips (JIT Onboarding):**
1. **`hasSeenVaporize`**: Appears on the game board when the community has already solved a shape you created. Explains the Magic Wand.
2. **`hasSeenAbacus`**: Appears on the game board when a shape's score is mathematically perfect. Explains the Abacus.
3. **`hasSeenCanvasSelect`**: Appears when you make a cut that splits the board into multiple non-trivial pieces. Guides you to select which piece to keep active.
4. **`hasSeenBankedGraph`**: Appears when a graph is sent to the Bank, reminding the user they can swap it with the active board.
5. **`hasSeenMatrixTileClick`**: Appears on the Matrix View, guiding the user to click a populated tile to see its specific grid leaderboard.
6. **`hasSeenRunClick`**: Appears on a specific grid leaderboard, guiding the user to click a run to view its replay.
7. **`hasSeenReplayDeepDive`**: Appears in Replay Mode when a vaporize step is reached, explaining that the vaporized block can be clicked to enter a deep dive.

---

## The Rendering Engine (`PixiVisualizer`)

Because HTML/DOM elements become incredibly sluggish when rendering hundreds of nodes and edges with dynamic hover states and animations, HOWL uses **PixiJS** (via WebGL) to render the grid graphs.

### `PixiVisualizer.tsx`
This component acts as a bridge between the React/Redux world and the WebGL canvas.
1. **Reconciliation**: It takes the current `GridGraph` object from Redux and translates it into Pixi `Graphics` and `Sprite` primitives.
2. **Viewport Management**: It wraps the scene in a `pixi-viewport` to allow for drag-to-pan and pinch-to-zoom controls.
3. **Split View**: If the user enables split-view, the visualizer splits the canvas into two interactive panes, rendering `activeGraph` on the left and `recentCutGraphs[0]` on the right.
4. **Interaction**: Clicks on nodes are registered as local component state (`pendingCutSet`). When the user commits a cut, the local state is dispatched to Redux.
5. **Magic Wand**: If the backend reports that a subgraph has a known optimal rank, the visualizer overlays a Magic Wand icon on that subgraph. Clicking it dispatches a "vaporize" action.

---

## Data Flow & Backend Communication

All backend communication is centralized in `src/api/api.ts`. The frontend expects the backend to be available at the URL defined in `VITE_API_URL`.

### The Polling Loop
When the graph state changes in Redux (e.g., after a cut or an undo), a `useEffect` hook in `GamePage.tsx` fires.
1. It extracts the raw coordinates of every disconnected subgraph currently on the board.
2. It sends these coordinates to `POST /api/check_shapes`.
3. The backend calculates canonical hashes and responds with any known optimal bounds from the `subgraph_dictionary`.
4. The frontend stores these optimal ranks in a local React state (`optimalRanks` Map) mapped by a local, non-canonical fingerprint.
5. `PixiVisualizer` reads this map to overlay the Magic Wand icons.

### Authentication
The app uses a simple token-based gatekeeper for administrative actions (submitting and deleting scores). 
- If a user attempts to submit a score, the app checks `localStorage` for `auth_token`. 
- If missing or invalid, it redirects the user to `/login`.
- Read operations (fetching the leaderboard, checking shapes) are unauthenticated and do not require the token.

---

## UI Layout & Mobile Responsiveness

HOWL relies on **CSS Grid** to structure its application shell (`.app-shell`).

### Desktop Layout
On desktop, the layout is a strict `100vh` grid:
- A fixed left sidebar for "Banked Graphs" and controls.
- A top navigation bar.
- A central, isolated scrolling area for the `main-stage` where the `PixiVisualizer` lives.

### Mobile Layout
On devices `< 768px`, the strict `100vh` constraint is removed to favor **native page scrolling**.
- The `app-shell` stacks vertically: Top Nav → Game Board → Sidebar.
- The `useStageSize` React hook detects the mobile viewport and ensures the `PixiVisualizer` canvas scales evenly (height matching width) to maximize playable area without being artificially cropped by flexbox containers.
- The player naturally swipes down the page to access the Banked Graphs and Undo/Redo controls.
