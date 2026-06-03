import type { Vertex } from "../state/gameSlice";

/**
 * The 8 D4 symmetry transformations (rotations + reflections).
 * Matches the backend's `get_transformations()` in graph_logic.py.
 */
const D4_TRANSFORMS: ((x: number, y: number) => [number, number])[] = [
  (x, y) => [x, y],      // Identity
  (x, y) => [-y, x],     // Rot 90
  (x, y) => [-x, -y],    // Rot 180
  (x, y) => [y, -x],     // Rot 270
  (x, y) => [-x, y],     // Reflect X
  (x, y) => [-y, -x],    // Reflect X + Rot 90
  (x, y) => [x, -y],     // Reflect X + Rot 180
  (x, y) => [y, x],      // Reflect X + Rot 270
];

/**
 * Normalize a set of coordinates so the minimum x and y are both 0.
 */
const normalize = (coords: [number, number][]): [number, number][] => {
  const minX = Math.min(...coords.map(([x]) => x));
  const minY = Math.min(...coords.map(([, y]) => y));
  return coords.map(([x, y]) => [x - minX, y - minY]);
};

/**
 * Check if `small` can be spatially embedded inside `large` under any
 * of the 8 D4 transformations (4 rotations × 2 reflections).
 *
 * Both inputs are arrays of grid-aligned vertices. The function checks
 * whether every tile of `small` overlaps with a tile in `large` at some
 * translation offset, for at least one transformation of `small`.
 */
export const isSubgraphOf = (small: Vertex[], large: Vertex[]): boolean => {
  if (small.length > large.length) return false;
  if (small.length === 0) return true;

  // Build a fast lookup set for the large shape (normalized to origin)
  const largeCoords = normalize(large.map((v) => [v.x, v.y]));
  const largeSet = new Set(largeCoords.map(([x, y]) => `${x},${y}`));
  const largeMaxX = Math.max(...largeCoords.map(([x]) => x));
  const largeMaxY = Math.max(...largeCoords.map(([, y]) => y));

  for (const transform of D4_TRANSFORMS) {
    // Transform and normalize the small shape
    const transformedSmall = normalize(
      small.map((v) => transform(v.x, v.y))
    );

    const smallMaxX = Math.max(...transformedSmall.map(([x]) => x));
    const smallMaxY = Math.max(...transformedSmall.map(([, y]) => y));

    // The small shape can only slide within the large shape's bounding box
    const maxDx = largeMaxX - smallMaxX;
    const maxDy = largeMaxY - smallMaxY;

    if (maxDx < 0 || maxDy < 0) continue;

    // Try every valid translation offset
    for (let dx = 0; dx <= maxDx; dx++) {
      for (let dy = 0; dy <= maxDy; dy++) {
        let allMatch = true;
        for (const [sx, sy] of transformedSmall) {
          if (!largeSet.has(`${sx + dx},${sy + dy}`)) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) return true;
      }
    }
  }

  return false;
};
