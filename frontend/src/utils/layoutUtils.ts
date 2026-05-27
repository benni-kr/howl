import type { Graph } from "../state/gameSlice";

export interface GraphLayout {
  index: number;
  offsetX: number;
  offsetY: number;
  pixelWidth: number;
  pixelHeight: number;
}

interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

function calculateBoundingBox(graph: Graph): BoundingBox {
  if (graph.vertices.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 1, height: 1 };
  }

  const xs = graph.vertices.map((v) => v.x);
  const ys = graph.vertices.map((v) => v.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Calculates non-overlapping positions for multiple subgraphs using shelf packing.
 * Uses pure mathematical bounding boxes (not Pixi bounds).
 *
 * @param graphs - Array of Graph objects to pack
 * @param cellSize - Pixel size of each grid cell
 * @param maxPixelWidth - Maximum pixel width before wrapping to next row
 * @param paddingPixels - Pixel gap between graphs (to avoid overlap/glow clipping)
 * @returns Array of layout objects with pixel-space positions and dimensions
 */
export function calculateBinPackLayout(
  graphs: Graph[],
  cellSize: number,
  maxPixelWidth: number,
  paddingPixels: number = cellSize,
): GraphLayout[] {
  if (graphs.length === 0) {
    return [];
  }

  // Calculate bounding boxes for all graphs (in grid cells)
  const graphBounds = graphs.map((graph, index) => ({
    index,
    bbox: calculateBoundingBox(graph),
  }));

  // Sort by height (tallest first) for better packing
  const sorted = [...graphBounds].sort((a, b) => b.bbox.height - a.bbox.height);

  const layouts: GraphLayout[] = [];

  const gap = Math.max(0, paddingPixels);

  let currentRowX = 0;
  let currentRowY = 0;
  let currentRowMaxHeight = 0;

  for (const item of sorted) {
    const { index, bbox } = item;
    const widthPixels = bbox.width * cellSize;
    const heightPixels = bbox.height * cellSize;

    // Check if we need to start a new row
    if (currentRowX + widthPixels + gap > maxPixelWidth && currentRowX > 0) {
      // Move to next row
      currentRowY += currentRowMaxHeight + gap;
      currentRowX = 0;
      currentRowMaxHeight = 0;
    }

    const offsetX = currentRowX;
    const offsetY = currentRowY;

    layouts.push({
      index,
      offsetX,
      offsetY,
      pixelWidth: widthPixels,
      pixelHeight: heightPixels,
    });

    currentRowX += widthPixels + gap;
    currentRowMaxHeight = Math.max(currentRowMaxHeight, heightPixels);
  }

  // Sort back to original index order
  layouts.sort((a, b) => a.index - b.index);

  return layouts;
}
