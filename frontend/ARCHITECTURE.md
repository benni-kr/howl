# HOWL Frontend Architecture

> **Audience:** Future contributors and AI agents working on the HOWL frontend codebase.

## Overview

The HOWL frontend is a Single Page Application (SPA) built with **React**, **TypeScript**, and **Vite**. It uses **Redux Toolkit** for state management and **PixiJS** for high-performance 2D WebGL rendering of the graph puzzles.

## Tech Stack

- **Framework**: React 18
- **Build Tool**: Vite
- **State Management**: Redux Toolkit (RTK)
- **2D Rendering**: PixiJS (`pixi.js`, `@pixi/react`, `pixi-viewport`)
- **Routing**: React Router DOM
- **Styling**: Vanilla CSS (with CSS Grid and Flexbox) + CSS Variables for dynamic theming
- **Icons**: React Icons (Lucide/Fa)

---

## State Management (Redux)

The application relies heavily on Redux to manage the complex, highly-nested state of the mathematical graphs and user preferences.

### `gameSlice.ts`
Manages the core gameplay mechanics and graph state.
- **`activeGraph`**: The main graph currently being played on the board.
- **`recentCutGraphs`**: When a cut divides a graph into multiple subgraphs, the largest goes to `activeGraph`, and the rest go here.
- **`bankedGraphs`**: An inventory of unsolved subgraphs that the player can swap in and out of the active slot.
- **`cutsApplied`**: The linear history of actions (cuts, vaporizes, duplicate-ignores) used to serialize the solution for the backend.
- **`history`**: A stack of previous states used to power the robust Undo/Redo mechanic.

### `settingsSlice.ts`
Manages global UI configurations.
- **`theme`**: Toggles between `light` and `dark` modes.
- **`colorPalette`**: Determines the block coloring scheme (e.g., Default, Neon, Pastel, Monokai) inside the PixiJS canvas.
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

## Graph Algorithms (`src/utils/`)

The frontend implements several graph algorithms to provide instant UI feedback without waiting for network requests.

### Connected Components (BFS) & Strict Validation
When a player makes a cut, the frontend needs to know immediately how the board fragments. `executeCutLocal` in `graphUtils.ts` implements an optimized **Breadth-First Search (BFS)** using an index-based queue (to ensure $O(1)$ dequeues instead of $O(n)$ array shifts). This BFS traverses the remaining vertices to identify all distinct connected components and rebuilds their valid edges locally.

To protect against UI-state desyncs (e.g. "Phantom Nodes" remaining selected across graph swaps), `executeCutLocal` enforces **strict validation** by asserting that every vertex in the proposed `pendingCutSet` explicitly exists within the `activeGraph`. If a mismatch is detected, it throws a localized error to block the dispatch, safeguarding the integrity of the Redux state and preventing corrupted game sequences.

### Subgraph Isomorphism (Subset Containment)
To power the "Subset Vaporize" batch action, the frontend must check if a smaller graph $A$ can fit entirely inside a larger graph $B$. `isSubgraphOf` in `subgraphUtils.ts` solves this 2D subgraph isomorphism problem by:
1. Normalizing both graphs to the origin.
2. Applying the 8 symmetry transformations (Dihedral group $D_4$) to the smaller graph.
3. Sliding the transformed smaller graph across the bounded spatial grid of the larger graph.
4. Returning true if a perfect coordinate subset match is found.

### Local Fingerprinting
To manage active graph caching without complex geometry, the frontend implements an $O(V \log V)$ localized graph fingerprinting algorithm (`getLocalGraphFingerprint`). While not rotationally invariant like the backend's canonical hash, it is used strictly for exact-match coordinate deduplication within a single render cycle.

---

## The Rendering Engine (`PixiVisualizer`)

Because HTML/DOM elements become incredibly sluggish when rendering hundreds of nodes and edges with dynamic hover states, HOWL uses **PixiJS** (via WebGL) to render the grid graphs.

### `PixiVisualizer.tsx`
This component acts as a bridge between the React/Redux world and the WebGL canvas.
1. **Reconciliation**: It translates the current `GridGraph` object from Redux into Pixi `Graphics` primitives based on the active `colorPalette`.
2. **Viewport Management**: It wraps the scene in a `pixi-viewport` to allow for drag-to-pan and pinch-to-zoom controls.
3. **Split View**: If the user enables split-view (or makes a cut resulting in multiple fragments), the visualizer splits the canvas into two interactive panes, rendering `activeGraph` on the left and `recentCutGraphs[0]` on the right.
4. **Interaction**: Clicks on nodes are registered as local component state (`pendingCutSet`). Committing a cut dispatches it to Redux.
5. **Batch Actions Overlay**: If the backend reports that a subgraph has a known optimal rank or is mathematically perfect, the visualizer overlays a Magic Wand or Abacus icon on that subgraph.

---

## The Replay Engine UI

HOWL features a dedicated Replay system to view community solutions.
- **`ReplayPage.tsx`**: Uses a custom `useReplayEngine` hook to step through the decompressed action history block by block.
- **VCR Controls**: Allows users to step forward, backward, play/pause, or skip to the end of a replay.
- **Elimination Tree (`TreeModal.tsx`)**: A visual diagram that dynamically draws the mathematical Treedepth Decomposition as the replay progresses, illustrating exactly how the score is derived.
- **Forking**: Players can click "Fork Replay" at any point to clone the current replay board state into their own active Game session.

---

## Data Flow & Backend Communication

All backend communication is centralized in `src/api/api.ts`. The frontend expects the backend to be available at the URL defined in `VITE_API_URL`.

### The Polling Loop
When the graph state changes in Redux (e.g., after a cut or an undo), a `useEffect` hook in `GamePage.tsx` fires.
1. It extracts the raw coordinates of every disconnected subgraph currently on the board.
2. It sends these coordinates to `POST /api/game/check_shapes`.
3. The backend calculates canonical hashes and responds with any known optimal bounds and an `is_optimal` boolean.
4. The frontend stores these optimal ranks in a local React state (`optimalRanks` Map) mapped by a local, non-canonical fingerprint.
5. `PixiVisualizer` reads this map to overlay the Magic Wand / Abacus icons.

### Payload Compaction (DTO Pattern)
To handle large grids (e.g., $100 \times 100$) efficiently over the network, the application employs a Data Transfer Object (DTO) pattern:
1. **In-Memory (Verbose)**: The frontend stores cut history in Redux using a verbose, human-readable format (`{ type: "cut", vertices: [{x: 0, y: 0}] }`). This ensures React components and Redux logic remain clean.
2. **Network/Storage (Compact)**: When submitting a score via `submitScore`, `api.ts` compacts the payload into a highly minimal format (`{ t: "c", v: [[0, 0]] }`). This reduces network payload size significantly.
3. **Rehydration**: When fetching replays via `fetchSolution`, `api.ts` automatically decompacts the payload back into the verbose format, keeping the Replay engine UI completely decoupled from the transport schema.

### Preventing Double-Submission (React Strict Mode)
During development, React 18's Strict Mode intentionally double-fires `useEffect` hooks. To prevent this from triggering concurrent duplicate POST requests (which would crash against backend database UNIQUE constraints), API submission hooks in modals (like `VictoryModal`) cache the resulting Promise using a `useRef`. If a second effect fires before the first finishes, it simply `await`s the exact same cached Promise, completely neutralizing the race condition.

---

## UI Component Architecture

### Decoupling React & WebGL
- **`PixiEngine`**: A pure WebGL abstraction layer. It has no knowledge of React or Redux. It strictly handles canvas mounting, viewport scaling (`pixi-viewport`), and event dispatching (clicks/drags).
- **`GridDrawer`**: A stateless rendering utility that takes normalized `GridGraph` arrays and draws the exact Pixi `Graphics` rectangles and edges based on the provided theme.
- **`PixiVisualizer`**: The React bridge. It uses `useSelector` to pull Redux data and feeds it into `PixiEngine` and `GridDrawer`, acting as the only point of reconciliation between the virtual DOM and the WebGL context.

### Decomposing GamePage
The top-level `GamePage` layout was flattened by extracting heavy logic into sub-components:
- **`useCutExecution`**: A custom React Hook that abstracts the complex `executeCutLocal` logic and dispatches the resulting board fragments into Redux.
- **`RankPanel`**: A specialized component that calculates the current active score by examining `cutsApplied` and active children.
- **`BatchActionBar`**: Isolates the "Magic Wand", "Subset Vaporize", and "Mirror Duplicate" UI controls into a floating overlay that only renders when the `checkShapes` API polling returns a match.

---

## UI Layout & Responsiveness

HOWL relies on **CSS Grid** to structure its application shell (`.app-shell`).

### Desktop Layout
On desktop, the layout is a strict `100vh` grid:
- A fixed left sidebar for "Banked Graphs" and action controls.
- A top navigation bar housing global settings.
- A central, isolated scrolling area for the `main-stage` where the `PixiVisualizer` lives.

### Mobile Layout
On devices `< 768px`, the strict `100vh` constraint is removed to favor **native page scrolling**.
- The `app-shell` stacks vertically: Top Nav → Game Board → Sidebar.
- The `useStageSize` React hook detects the mobile viewport and ensures the `PixiVisualizer` canvas scales evenly (height matching width) to maximize playable area without being artificially cropped by flexbox containers.
- The player naturally swipes down the page to access the Banked Graphs and Undo/Redo controls.
