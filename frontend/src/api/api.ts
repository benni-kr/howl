import type { Graph, Vertex, CutHistoryAction } from "../state/gameSlice";

type ApiGraph = {
  vertices: number[][];
  edges: number[][][];
};

type CutResponse = {
  subgraphs: ApiGraph[];
};

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api";

const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const token = localStorage.getItem("howl_auth_token");
  const headers = new Headers(init?.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
};

export const login = async (username: string, password: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (response.ok) {
      const data = await response.json();
      localStorage.setItem("howl_auth_token", data.token);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
};

const CUT_URL = `${API_BASE_URL}/cut`;

const serializeGraph = (graph: Graph) => ({
  vertices: graph.vertices.map((vertex) => [vertex.x, vertex.y]),
  edges: graph.edges.map((edge) => [
    [edge.from.x, edge.from.y],
    [edge.to.x, edge.to.y],
  ]),
});

const serializeCutSet = (cutSet: Vertex[]) =>
  cutSet.map((vertex) => [vertex.x, vertex.y]);

const deserializeGraph = (graph: ApiGraph): Graph => ({
  vertices: graph.vertices.map(([x, y]) => ({ x, y })),
  edges: graph.edges.map(([[fromX, fromY], [toX, toY]]) => ({
    from: { x: fromX, y: fromY },
    to: { x: toX, y: toY },
  })),
  baseRank: 0,
});

export const executeCut = async (
  activeGraph: Graph,
  cutSet: Vertex[],
): Promise<Graph[]> => {
  try {
    const response = await apiFetch(CUT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...serializeGraph(activeGraph),
        cut_set: serializeCutSet(cutSet),
      }),
    });

    if (!response.ok) {
      throw new Error(`Cut request failed with status ${response.status}`);
    }

    const data = (await response.json()) as CutResponse;
    if (!data?.subgraphs) {
      throw new Error("Cut response missing subgraphs.");
    }

    return data.subgraphs.map(deserializeGraph);
  } catch (error) {
    console.error("executeCut failed:", error);
    throw error;
  }
};

export type ShapeResult = {
  hash: string;
  found: boolean;
  best_rank: number | null;
  is_optimal: boolean | null;
  discovered_by?: string | null;
};

export const checkShapes = async (graphs: Graph[]): Promise<ShapeResult[]> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/check_shapes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subgraphs: graphs.map((g, i) => ({
          index: i,
          vertices: g.vertices.map((v) => ({ x: v.x, y: v.y })),
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`checkShapes failed with status ${response.status}`);
    }

    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error("checkShapes failed:", error);
    return [];
  }
};

type SubmitResponse = {
  updated: boolean;
  solution: {
    id: number;
    m: number;
    n: number;
    rank: number;
    solver_name: string;
    cut_sequence: CutHistoryAction[];
  };
};

export const submitScore = async (
  m: number,
  n: number,
  rank: number,
  solverName: string,
  cutSequence: CutHistoryAction[],
): Promise<SubmitResponse> => {
  // Network/DB Optimization: Compact the sequence before sending to save ~70% payload size
  // "c" = cut, "v" = vaporize, "i" = ignore. Vertices become flat [x, y] tuples.
  const compactSequence = cutSequence.map((action) => {
    const v = action.vertices.map((vtx) => [vtx.x, vtx.y]);
    if (action.type === "cut") return { t: "c", v };
    if (action.type === "vaporize") return { t: "v", v, r: action.optimal_rank };
    return { t: "i", v };
  });

  const response = await apiFetch(`${API_BASE_URL}/submit_solution`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      m,
      n,
      achieved_rank: rank,
      solver_name: solverName,
      cut_sequence: compactSequence,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("FastAPI Validation Error:", errorBody);
    throw new Error(`Submit score failed with status ${response.status}`);
  }

  const data = await response.json();
  if (data?.solution?.cut_sequence) {
    data.solution.cut_sequence = decompactSequence(data.solution.cut_sequence);
  }
  return data as SubmitResponse;
};

type TopScoreResponse = {
  id: number;
  m: number;
  n: number;
  rank: number;
  solver_name: string;
  cut_sequence: CutHistoryAction[];
};

/**
 * Decompacts the network-optimized cut sequence back into the verbose format used by the frontend.
 * 
 * Architecture Note (DTO Pattern):
 * The frontend relies on a verbose format (e.g. { type: "cut", vertices: [{x, y}] }) for readability 
 * in React components and Redux state. However, to save bandwidth and DB storage, the data is compacted
 * over the network to { t: "c", v: [[x, y]] }. This helper safely expands it back for UI consumption, 
 * while maintaining backwards compatibility with any legacy uncompacted data in the database.
 */
export const decompactSequence = (sequence: any): CutHistoryAction[] => {
  if (!Array.isArray(sequence)) return [];
  
  return sequence.map(action => {
    // Legacy / uncompacted format
    if (action.type && action.vertices && (!action.vertices.length || ('x' in action.vertices[0]))) {
      return action as CutHistoryAction;
    }
    
    // Compact format { t, v, r }
    const vertices = Array.isArray(action.v) ? action.v.map(([x, y]: number[]) => ({ x, y })) : [];
    
    if (action.t === "v") {
      return {
        type: "vaporize",
        vertices,
        optimal_rank: action.r !== undefined ? action.r : 0,
      } as CutHistoryAction;
    } else if (action.t === "c") {
      return {
        type: "cut",
        vertices,
      } as CutHistoryAction;
    } else {
      return {
        type: "ignore",
        vertices,
      } as CutHistoryAction;
    }
  });
};

export const fetchTopScore = async (
  m: number,
  n: number,
  solverName?: string
): Promise<TopScoreResponse | null> => {
  try {
    const url = solverName 
      ? `${API_BASE_URL}/solution/${m}/${n}?solver_name=${encodeURIComponent(solverName)}`
      : `${API_BASE_URL}/solution/${m}/${n}`;
    const response = await apiFetch(url);
    if (response.status === 404) {
      return null; // no solution exists
    }
    if (!response.ok) {
      return null; // gracefully handle failure
    }
    const data = await response.json();
    if (data && data.cut_sequence) {
      data.cut_sequence = decompactSequence(data.cut_sequence);
    }
    return data || null;
  } catch (error) {
    console.error("fetchTopScore failed:", error);
    return null;
  }
};

export type MatrixCellData = {
  m: number;
  n: number;
  min_rank: number;
  solver_name: string;
  is_optimal: boolean;
};

export const fetchMatrixLeaderboard = async (): Promise<MatrixCellData[]> => {
  const response = await apiFetch(`${API_BASE_URL}/leaderboard/matrix`);
  if (!response.ok) {
    throw new Error(`fetchMatrixLeaderboard failed: ${response.status}`);
  }
  return response.json();
};

export type TopSolverData = {
  solver_name: string;
  first_places: number;
};

export const fetchTopSolvers = async (
  squareOnly: boolean = false,
): Promise<TopSolverData[]> => {
  const query = squareOnly ? "?square_only=true" : "";
  const response = await apiFetch(
    `${API_BASE_URL}/leaderboard/top_solvers${query}`,
  );
  if (!response.ok) {
    throw new Error(`fetchTopSolvers failed: ${response.status}`);
  }
  return response.json();
};

export type GridLeaderboardEntry = {
  rank_position: number;
  solver_name: string;
  achieved_rank: number;
  created_at: string;
};

export const fetchGridLeaderboard = async (
  m: number,
  n: number,
): Promise<GridLeaderboardEntry[]> => {
  const response = await apiFetch(`${API_BASE_URL}/leaderboard/grid/${m}/${n}`);
  if (!response.ok) {
    throw new Error(`fetchGridLeaderboard failed: ${response.status}`);
  }
  return response.json();
};
