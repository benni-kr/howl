import type { Graph, Vertex, Edge } from "../state/gameSlice";

// Helper to safely serialize a vertex for Set lookups
const getVertexKey = (v: Vertex) => `${v.x},${v.y}`;

/**
 * Replaces the backend `/api/cut` endpoint by performing a local BFS 
 * to find the disconnected subgraphs after a cut.
 */
export const executeCutLocal = (activeGraph: Graph, cutSet: Vertex[]): Graph[] => {
  const cutKeys = new Set(cutSet.map(getVertexKey));
  
  // Filter out the cut vertices to get the remaining board
  const remainingVertices = activeGraph.vertices.filter(
    (v) => !cutKeys.has(getVertexKey(v))
  );
  
  const remainingKeys = new Set(remainingVertices.map(getVertexKey));
  const visited = new Set<string>();
  const subgraphs: Graph[] = [];

  // 4-way grid adjacency
  const getNeighbors = (v: Vertex): Vertex[] => [
    { x: v.x + 1, y: v.y },
    { x: v.x - 1, y: v.y },
    { x: v.x, y: v.y + 1 },
    { x: v.x, y: v.y - 1 },
  ];

  for (const startVertex of remainingVertices) {
    const startKey = getVertexKey(startVertex);
    if (visited.has(startKey)) continue;

    const componentVertices: Vertex[] = [];
    const queue: Vertex[] = [startVertex];
    visited.add(startKey);

    // Run BFS to find all connected vertices in this subgraph
    while (queue.length > 0) {
      const curr = queue.shift()!;
      componentVertices.push(curr);

      for (const neighbor of getNeighbors(curr)) {
        const neighborKey = getVertexKey(neighbor);
        if (remainingKeys.has(neighborKey) && !visited.has(neighborKey)) {
          visited.add(neighborKey);
          queue.push(neighbor);
        }
      }
    }

    // Reconstruct valid grid edges for this specific component
    const edges: Edge[] = [];
    const componentKeys = new Set(componentVertices.map(getVertexKey));
    
    for (const v of componentVertices) {
      // Only check 'right' and 'down' to avoid duplicating bidirectional edges
      const rightNeighbor = { x: v.x + 1, y: v.y };
      const downNeighbor = { x: v.x, y: v.y + 1 };
      
      if (componentKeys.has(getVertexKey(rightNeighbor))) {
        edges.push({ from: { x: v.x, y: v.y }, to: rightNeighbor });
      }
      if (componentKeys.has(getVertexKey(downNeighbor))) {
        edges.push({ from: { x: v.x, y: v.y }, to: downNeighbor });
      }
    }

    subgraphs.push({
      vertices: componentVertices,
      edges,
      baseRank: 0, // Deserialization logic expects 0 (rank is additive in state)
    });
  }

  return subgraphs;
};
