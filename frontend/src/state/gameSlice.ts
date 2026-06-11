import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { buildGridGraph } from "../utils/graphUtils";

export interface Vertex {
  x: number;
  y: number;
}

export interface Edge {
  from: Vertex;
  to: Vertex;
}

export interface Graph {
  vertices: Vertex[];
  edges: Edge[];
  baseRank: number;
}

/**
 * Build a local fingerprint for a graph based on its vertex coordinates.
 *
 * ⚠️  This is NOT a canonical hash — it is position-dependent and does NOT
 * account for rotation or reflection.  It is only used as a **local Map key**
 * within a single React render to correlate graphs with their checkShapes
 * results.  Never compare this value against the backend's canonical hash.
 */
const _fingerprintCache = new WeakMap<readonly Vertex[], string>();

export const getLocalGraphFingerprint = (graph: Graph) => {
  const cached = _fingerprintCache.get(graph.vertices);
  if (cached !== undefined) return cached;

  const sorted = [...graph.vertices].sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  const fp = sorted.map((v) => `${v.x},${v.y}`).join("|");
  _fingerprintCache.set(graph.vertices, fp);
  return fp;
};

export type CutHistoryAction =
  | { type: "cut"; vertices: Vertex[] }
  | { type: "vaporize"; vertices: Vertex[]; optimal_rank: number }
  | { type: "ignore"; vertices: Vertex[] }
  | { type: "subgraph"; vertices: Vertex[] };

export interface GameHistoryEntry {
  activeGraph: Graph | null;
  bankedGraphs: Graph[];
  recentCutGraphs: Graph[];
  maxRank: number;
  gridSize: { m: number; n: number };
  cutsApplied: CutHistoryAction[];
}

export interface GameState {
  activeGraph: Graph | null;
  bankedGraphs: Graph[];
  recentCutGraphs: Graph[];
  history: GameHistoryEntry[];
  futureHistory: GameHistoryEntry[];
  maxRank: number;
  gridSize: { m: number; n: number };
  cutsApplied: CutHistoryAction[];
}

/**
 * Maximum number of undo history entries to retain.
 * Oldest entries are dropped when this limit is exceeded.
 */
const MAX_HISTORY_LENGTH = 30;

/**
 * Shallow-clone a graph.  Vertex and Edge objects are immutable value
 * objects (never mutated after creation), so we only need to copy the
 * arrays themselves, not each element.
 */
const cloneGraph = (graph: Graph | null): Graph | null => {
  if (!graph) {
    return null;
  }

  return {
    vertices: [...graph.vertices],
    edges: [...graph.edges],
    baseRank: graph.baseRank,
  };
};

const snapshotState = (state: GameState): GameHistoryEntry => ({
  activeGraph: cloneGraph(state.activeGraph),
  bankedGraphs: state.bankedGraphs.map((graph) => cloneGraph(graph) as Graph),
  recentCutGraphs: state.recentCutGraphs.map(
    (graph) => cloneGraph(graph) as Graph,
  ),
  maxRank: state.maxRank,
  gridSize: { ...state.gridSize },
  cutsApplied: [...state.cutsApplied],
});

/** Push a snapshot onto history, capping at MAX_HISTORY_LENGTH. */
const pushHistory = (state: GameState) => {
  state.history.push(snapshotState(state));
  if (state.history.length > MAX_HISTORY_LENGTH) {
    state.history.splice(0, state.history.length - MAX_HISTORY_LENGTH);
  }
  state.futureHistory = [];
};

/** Shared helper to pull the next available graph into the active slot. */
const pullNextGraph = (state: GameState) => {
  if (!state.activeGraph) {
    if (state.recentCutGraphs.length > 0) {
      state.activeGraph = state.recentCutGraphs.shift() || null;
    } else if (state.bankedGraphs.length > 0) {
      state.activeGraph = state.bankedGraphs.pop() || null;
    }
  }
};

/** Shared helper to safely extract a graph from its array/slot. */
const removeGraphFromLocation = (state: GameState, location: 'active' | 'banked' | 'recent', index?: number): Graph | null => {
  let targetGraph: Graph | null = null;
  if (location === 'active' && state.activeGraph) {
    targetGraph = state.activeGraph;
    state.activeGraph = null;
  } else if (location === 'banked' && index !== undefined) {
    targetGraph = state.bankedGraphs[index];
    state.bankedGraphs.splice(index, 1);
  } else if (location === 'recent' && index !== undefined) {
    targetGraph = state.recentCutGraphs[index];
    state.recentCutGraphs.splice(index, 1);
  }
  return targetGraph;
};

const initialState: GameState = {
  activeGraph: buildGridGraph(5, 5),
  bankedGraphs: [],
  recentCutGraphs: [],
  history: [],
  futureHistory: [],
  maxRank: 0,
  gridSize: { m: 5, n: 5 },
  cutsApplied: [],
};

const gameSlice = createSlice({
  name: "game",
  initialState,
  reducers: {
    /**
     * Reset all game state for a new m×n grid.
     * Creates a fresh grid graph, clears history, banked graphs, and cuts.
     */
    initializeGame(state, action: PayloadAction<{ m: number; n: number }>) {
      const { m, n } = action.payload;
      state.activeGraph = buildGridGraph(m, n);
      state.bankedGraphs = [];
      state.recentCutGraphs = [];
      state.history = [];
      state.futureHistory = [];
      state.maxRank = 0;
      state.gridSize = { m, n };
      state.cutsApplied = [];
    },
    /**
     * Apply a cut result from the backend to the active graph.
     *
     * - Snapshots current state for undo.
     * - Records the cut in `cutsApplied`.
     * - Computes `baseRank` for all resulting subgraphs:
     *   `newBaseRank = activeGraph.baseRank + cutSize`.
     * - First subgraph becomes the new `activeGraph`; rest go to `recentCutGraphs`.
     *
     * Invariant: after this reducer, `recentCutGraphs` may be non-empty,
     * requiring split-view selection before the next cut.
     */
    applyCutResult(state, action: PayloadAction<{ subgraphs: Graph[], cutSet: Vertex[] }>) {
      const { subgraphs, cutSet } = action.payload;
      if (!state.activeGraph) {
        return;
      }
      if (state.recentCutGraphs.length > 0) {
        console.warn("Cut rejected: Must confirm graph selection first.");
        return;
      }

      pushHistory(state);
      
      state.cutsApplied.push({ type: "cut", vertices: cutSet });

      if (subgraphs.length === 0) {
        // The graph was completely eliminated.
        const cutSize = state.activeGraph.vertices.length;
        const finalRank = state.activeGraph.baseRank + cutSize;
        state.maxRank = Math.max(state.maxRank, finalRank);
        state.activeGraph = null;
        return;
      }

      const subgraphsVertexCount = subgraphs.reduce((sum, g) => sum + g.vertices.length, 0);
      const cutSize = state.activeGraph.vertices.length - subgraphsVertexCount;
      const newBaseRank = state.activeGraph.baseRank + cutSize;
      
      const rankedSubgraphs = subgraphs.map(g => ({ ...g, baseRank: newBaseRank }));

      state.activeGraph = rankedSubgraphs[0];
      state.recentCutGraphs = rankedSubgraphs.slice(1);
    },
    /**
     * Confirm which subgraph the player wants to continue cutting.
     *
     * Called from split-view. The selected graph becomes `activeGraph`;
     * all others are pushed to `bankedGraphs`. Clears `recentCutGraphs`.
     */
    confirmGraphSelection(state, action: PayloadAction<number>) {
      const index = action.payload;
      const allOptions = state.activeGraph ? [state.activeGraph, ...state.recentCutGraphs] : [...state.recentCutGraphs];
      
      if (index >= 0 && index < allOptions.length) {
        state.activeGraph = allOptions[index];
        allOptions.forEach((g, i) => {
          if (i !== index) {
            state.bankedGraphs.push(g);
          }
        });
      }
      state.recentCutGraphs = [];
    },
    /**
     * Swap the active graph with a banked or recent graph.
     *
     * Used by the sidebar to let the player switch which piece they're cutting.
     * The old active goes to banked; the target is removed from its source.
     */
    switchActiveGraph(state, action: PayloadAction<number>) {
      const index = action.payload;
      let targetGraph: Graph | null = null;

      if (index < state.recentCutGraphs.length) {
        targetGraph = state.recentCutGraphs[index];
        if (state.activeGraph) {
          state.bankedGraphs.push(state.activeGraph);
        }
        state.recentCutGraphs.splice(index, 1);
      } else {
        const bankedIndex = index - state.recentCutGraphs.length;
        if (bankedIndex >= 0 && bankedIndex < state.bankedGraphs.length) {
          targetGraph = state.bankedGraphs[bankedIndex];
          if (state.activeGraph) {
            state.bankedGraphs[bankedIndex] = state.activeGraph;
          } else {
            state.bankedGraphs.splice(bankedIndex, 1);
          }
        }
      }

      if (targetGraph) {
        state.activeGraph = targetGraph;
      }
    },
    /**
     * Undo the most recent action (cut or vaporize).
     *
     * Pops the last `GameHistoryEntry` from `history`, saves the current
     * state to `futureHistory` (for redo), and restores all fields.
     */
    undoCut(state) {
      if (state.history.length === 0) return;
      const previous = state.history.pop();
      if (!previous) return;

      // Save current state to futureHistory
      state.futureHistory.push(snapshotState(state));

      state.activeGraph = previous.activeGraph;
      state.bankedGraphs = previous.bankedGraphs;
      state.recentCutGraphs = previous.recentCutGraphs;
      state.maxRank = previous.maxRank;
      state.gridSize = previous.gridSize;
      state.cutsApplied = previous.cutsApplied;
    },
    /**
     * Redo a previously undone action.
     *
     * Pops from `futureHistory`, saves current to `history`, restores fields.
     */
    redoCut(state) {
      if (state.futureHistory.length === 0) return;
      const nextState = state.futureHistory.pop()!;
      state.history.push({
        activeGraph: state.activeGraph,
        bankedGraphs: [...state.bankedGraphs],
        recentCutGraphs: [...state.recentCutGraphs],
        maxRank: state.maxRank,
        cutsApplied: [...state.cutsApplied],
        gridSize: {...state.gridSize}
      });
      state.activeGraph = nextState.activeGraph;
      state.bankedGraphs = nextState.bankedGraphs;
      state.recentCutGraphs = nextState.recentCutGraphs;
      state.maxRank = nextState.maxRank;
      state.gridSize = nextState.gridSize;
      state.cutsApplied = nextState.cutsApplied;
    },
    devSolve(state) {
      state.cutsApplied = [
        { type: "cut", vertices: [[0, 0]] },
        { type: "cut", vertices: [[1, 1]] }
      ] as any;
      state.activeGraph = { vertices: [[0, 1]], edges: [], baseRank: 2 } as any;
      state.history = [{}] as any;
      state.bankedGraphs = [];
      state.recentCutGraphs = [];
      state.maxRank = 3;
    },
    /**
     * Remove all 1×1 (trivially solved) subgraphs from the board.
     *
     * For each 1×1 graph found, `maxRank` is updated to
     * `max(maxRank, graph.baseRank + 1)` since a single vertex has rank 1.
     * Does NOT pull a replacement from the bank — call `pullFromBankIfNeeded`
     * separately after animations finish.
     */
    removeSolvedSubgraphs(state) {
      const isOneByOne = (graph: Graph | null) => {
        return graph !== null && graph.vertices.length === 1;
      };

      const processSolved = (graph: Graph) => {
        if (isOneByOne(graph)) {
          const finalRank = graph.baseRank + 1;
          state.maxRank = Math.max(state.maxRank, finalRank);
        }
      };

      if (state.activeGraph) processSolved(state.activeGraph);
      state.recentCutGraphs.forEach(processSolved);
      state.bankedGraphs.forEach(processSolved);

      state.recentCutGraphs = state.recentCutGraphs.filter((g) => !isOneByOne(g));
      state.bankedGraphs = state.bankedGraphs.filter((g) => !isOneByOne(g));

      if (isOneByOne(state.activeGraph)) {
        state.activeGraph = null;
      }
    },
    /**
     * If `activeGraph` is null, pull the next graph to work on.
     *
     * Priority: `recentCutGraphs` (shift) → `bankedGraphs` (pop).
     * Called after `removeSolvedSubgraphs` or `autoSolveMultipleGraphs`.
     */
    pullFromBankIfNeeded(state) {
      pullNextGraph(state);
    },
    /**
     * Vaporize multiple graphs simultaneously.
     * 
     * Gathers all provided targets, removes them from active/recent/banked,
     * adds individual vaporize events to cutsApplied, and updates maxRank.
     * Processes indices in descending order to prevent shifting issues.
     */
    autoSolveMultipleGraphs(state, action: PayloadAction<{ targets: { location: 'active' | 'banked' | 'recent', index?: number, optimalRank: number }[] }>) {
      const { targets } = action.payload;
      if (targets.length === 0) return;

      pushHistory(state);

      // Sort targets: we must process removals from arrays in descending index order
      // to avoid index shifting.
      const sortedTargets = [...targets].sort((a, b) => {
        const indexA = a.index ?? -1;
        const indexB = b.index ?? -1;
        return indexB - indexA;
      });

      for (const target of sortedTargets) {
        const targetGraph = removeGraphFromLocation(state, target.location, target.index);

        if (targetGraph) {
          state.maxRank = Math.max(state.maxRank, targetGraph.baseRank + target.optimalRank);
          state.cutsApplied.push({
            type: "vaporize",
            vertices: [...targetGraph.vertices],
            optimal_rank: target.optimalRank
          });
        }
      }

      pullNextGraph(state);
    },
    ignoreMultipleGraphs(state, action: PayloadAction<{ targets: { location: 'active' | 'banked' | 'recent', index?: number }[], actionType?: 'ignore' | 'subgraph' }>) {
      const { targets, actionType = 'ignore' } = action.payload;
      if (targets.length === 0) return;

      pushHistory(state);

      const sortedTargets = [...targets].sort((a, b) => {
        const indexA = a.index ?? -1;
        const indexB = b.index ?? -1;
        return indexB - indexA;
      });

      for (const target of sortedTargets) {
        const targetGraph = removeGraphFromLocation(state, target.location, target.index);

        if (targetGraph) {
          state.cutsApplied.push({
            type: actionType,
            vertices: [...targetGraph.vertices]
          });
        }
      }

      pullNextGraph(state);
    },
    /**
     * Completely overwrite the game state. Used for forking a replay.
     */
    forkGame(_state, action: PayloadAction<GameState>) {
      return action.payload;
    },
  },
});

export const {
  initializeGame,
  applyCutResult,
  switchActiveGraph,
  confirmGraphSelection,
  undoCut,
  redoCut,
  removeSolvedSubgraphs,
  pullFromBankIfNeeded,
  autoSolveMultipleGraphs,
  ignoreMultipleGraphs,
  forkGame,
} = gameSlice.actions;

const isSolvedGraph = (graph: Graph | null): boolean => {
  if (!graph) {
    return true;
  }
  return graph.vertices.length <= 1;
};

export const selectIsGameWon = (state: GameState): boolean => {
  if (state.history.length === 0) {
    return false;
  }
  
  const allGraphs = [
    ...(state.activeGraph ? [state.activeGraph] : []),
    ...state.bankedGraphs,
    ...state.recentCutGraphs
  ];
  
  if (allGraphs.length === 0) {
    return true;
  }
  
  return allGraphs.every(isSolvedGraph);
};

export default gameSlice.reducer;
