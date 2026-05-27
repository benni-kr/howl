import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type CSSProperties,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSelector } from "react-redux";

import type { Graph, Vertex } from "../../state/gameSlice";
import { calculateBinPackLayout } from "../../utils/layoutUtils";

type RootState = {
  game: {
    activeGraph: Graph | null;
    bankedGraphs: Graph[];
    recentCutGraphs: Graph[];
  };
};

export type GridVisualizerHandle = {
  animateCut: (cutSet: Vertex[]) => Promise<void>;
};

type GridVisualizerProps = {
  width: number;
  height: number;
  splitView: boolean;
  onSelectGraph?: (index: number) => void;
  selectedGraphIndex?: number | null;
  onPendingCutSetChange?: (cutSet: Vertex[]) => void;
  resetToken?: number;
};

type GraphMeta = {
  graph: Graph;
  index: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  widthCells: number;
  heightCells: number;
};

type GraphLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const BASE_CELL_SIZE = 20;
const MIN_CELL_SIZE = 8;
const GLOW_STYLE: CSSProperties = {
  filter: "drop-shadow(0px 0px 12px rgba(0, 255, 255, var(--glow)))",
};


const isSameVertex = (a: Vertex, b: Vertex) => a.x === b.x && a.y === b.y;

type AnimatedVertexProps = {
  vertex: Vertex;
  localX: number;
  localY: number;
  cellSize: number;
  isPendingCut: boolean;
  baseColor: string;
  splitView: boolean;
  onClick?: (event: MouseEvent) => void;
};

const AnimatedVertex = ({
  vertex,
  localX,
  localY,
  cellSize,
  isPendingCut,
  baseColor,
  splitView,
  onClick,
}: AnimatedVertexProps) => {
  const color = isPendingCut ? "#ef4444" : baseColor;

  return (
    <motion.rect
      layout
      layoutId={`vertex-${vertex.x}-${vertex.y}`}
      x={localX}
      y={localY}
      width={cellSize}
      height={cellSize}
      fill={color}
      stroke="#0f172a"
      strokeWidth={1}
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={
        isPendingCut
          ? {
            scale: [1, 1.8, 0],
            opacity: [1, 1, 0],
            rotate: [0, 45, 90],
            fill: ["#ef4444", "#ffffff", "#ef4444"],
            transition: { duration: 0.5, ease: "easeOut" },
          }
          : {
            scale: [1, 1.3, 0],
            y: [0, -20, -40],
            fill: ["#10b981", "#ffffff", "#fbbf24"],
            opacity: [1, 1, 0],
            transition: { duration: 0.6, ease: "easeInOut" },
          }
      }
      transition={{ duration: 0.3 }}
      style={{
        transformBox: "fill-box",
        transformOrigin: "center",
        cursor: splitView ? "pointer" : "crosshair",
      }}
      pointerEvents={splitView ? "none" : "auto"}
      onClick={onClick}
    />
  );
};

const GridVisualizer = forwardRef<GridVisualizerHandle, GridVisualizerProps>(
  (
    {
      width,
      height,
      splitView,
      onSelectGraph,
      selectedGraphIndex,
      onPendingCutSetChange,
      resetToken,
    },
    ref,
  ) => {
    const { activeGraph, recentCutGraphs } = useSelector(
      (state: RootState) => state.game,
    );
    const [pendingCutSet, setPendingCutSet] = useState<Vertex[]>([]);
    const [cuttingSet, setCuttingSet] = useState<Vertex[]>([]);
    const cutTimerRef = useRef<number | null>(null);

    useEffect(() => {
      return () => {
        if (cutTimerRef.current !== null) {
          window.clearTimeout(cutTimerRef.current);
        }
      };
    }, []);

    const displayGraphs = useMemo(() => {
      if (splitView && recentCutGraphs.length > 0) {
        const graphs = [activeGraph, ...recentCutGraphs];
        return graphs.filter((graph): graph is Graph => Boolean(graph));
      }
      return activeGraph ? [activeGraph] : [];
    }, [activeGraph, recentCutGraphs, splitView]);

    const graphMetas = useMemo<GraphMeta[]>(() => {
      return displayGraphs.map((graph, index) => {
        if (graph.vertices.length === 0) {
          return {
            graph,
            index,
            minX: 0,
            maxX: 0,
            minY: 0,
            maxY: 0,
            widthCells: 1,
            heightCells: 1,
          };
        }
        const xs = graph.vertices.map((v) => v.x);
        const ys = graph.vertices.map((v) => v.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return {
          graph,
          index,
          minX,
          maxX,
          minY,
          maxY,
          widthCells: maxX - minX + 1,
          heightCells: maxY - minY + 1,
        };
      });
    }, [displayGraphs]);

    const { layouts, cellSize, viewBox } = useMemo(() => {
      if (graphMetas.length === 0) {
        return {
          layouts: [],
          cellSize: BASE_CELL_SIZE,
          viewBox: `0 0 ${width} ${height}`,
        };
      }

      const maxWidthCells = Math.max(...graphMetas.map((m) => m.widthCells));
      const maxHeightCells = Math.max(...graphMetas.map((m) => m.heightCells));
      const fitCellSize = Math.min(
        width / Math.max(1, maxWidthCells),
        height / Math.max(1, maxHeightCells),
      );
      const cellSize = Math.max(
        MIN_CELL_SIZE,
        Math.min(BASE_CELL_SIZE, fitCellSize),
      );
      const paddingPixels = Math.max(cellSize * 1.5, 12);
      const maxRowWidth = Math.max(240, width * 0.9);

      const packLayout = calculateBinPackLayout(
        displayGraphs,
        cellSize,
        maxRowWidth,
        paddingPixels,
      );

      const layouts: GraphLayout[] = packLayout.map((layout) => ({
        x: layout.offsetX,
        y: layout.offsetY,
        width: layout.pixelWidth,
        height: layout.pixelHeight,
      }));

      const totalWidth = Math.max(...layouts.map((l) => l.x + l.width), 0);
      const totalHeight = Math.max(...layouts.map((l) => l.y + l.height), 0);

      const viewPadding = Math.max(cellSize, 16);
      const viewBox = `${-viewPadding} ${-viewPadding} ${totalWidth + viewPadding * 2
        } ${totalHeight + viewPadding * 2}`;

      return { layouts, cellSize, viewBox };
    }, [displayGraphs, graphMetas, height, width]);

    const toggleVertex = useCallback((vertex: Vertex) => {
      setPendingCutSet((prev) => {
        if (prev.some((item) => isSameVertex(item, vertex))) {
          return prev.filter((item) => !isSameVertex(item, vertex));
        }
        return [...prev, vertex];
      });
    }, []);

    const handleTileClick = useCallback(
      (graphIndex: number, vertex: Vertex, event?: MouseEvent) => {
        event?.stopPropagation();
        if (graphIndex === 0) {
          toggleVertex(vertex);
        }
      },
      [toggleVertex],
    );

    useEffect(() => {
      onPendingCutSetChange?.(pendingCutSet);
    }, [onPendingCutSetChange, pendingCutSet]);

    useEffect(() => {
      if (resetToken !== undefined) {
        setPendingCutSet([]);
      }
    }, [resetToken]);

    useEffect(() => {
      if (splitView) {
        setPendingCutSet([]);
      }
    }, [splitView]);

    useImperativeHandle(
      ref,
      () => ({
        animateCut: (cutSet: Vertex[]) =>
          new Promise((resolve) => {
            if (cutSet.length === 0) {
              resolve();
              return;
            }
            setCuttingSet(cutSet);
            if (cutTimerRef.current !== null) {
              window.clearTimeout(cutTimerRef.current);
            }
            cutTimerRef.current = window.setTimeout(() => {
              setCuttingSet([]);
              cutTimerRef.current = null;
              resolve();
            }, 320);
          }),
      }),
      [],
    );

    const isCuttingVertex = useCallback(
      (vertex: Vertex) => cuttingSet.some((item) => isSameVertex(item, vertex)),
      [cuttingSet],
    );

    return (
      <svg
        width={width}
        height={height}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{ background: "#0b0f1a", display: "block" }}
      >
        {graphMetas.map((meta, graphIndex) => {
          const layout = layouts[graphIndex];
          if (!layout) {
            return null;
          }

          const isGraphSelected =
            splitView &&
            selectedGraphIndex !== null &&
            selectedGraphIndex === graphIndex;

          const visibleVertices = meta.graph.vertices.filter(
            (vertex) => !isCuttingVertex(vertex),
          );
          const visibleEdges = meta.graph.edges.filter(
            (edge) => !isCuttingVertex(edge.from) && !isCuttingVertex(edge.to),
          );

          return (
            <motion.g
              key={`graph-${graphIndex}`}
              layout
              initial={false}
              animate={{
                x: layout.x,
                y: layout.y,
                "--glow": isGraphSelected ? 0.8 : 0,
              }}
              transition={{
                duration: 0.6,
                ease: "easeOut",
                "--glow": { duration: 0.25, ease: "easeOut" },
              }}
              style={{
                ...GLOW_STYLE,
                cursor: splitView ? "pointer" : "default",
              }}
            >
              {visibleEdges.map((edge, edgeIndex) => {
                const fromX =
                  (edge.from.x - meta.minX) * cellSize + cellSize / 2;
                const fromY =
                  (edge.from.y - meta.minY) * cellSize + cellSize / 2;
                const toX = (edge.to.x - meta.minX) * cellSize + cellSize / 2;
                const toY = (edge.to.y - meta.minY) * cellSize + cellSize / 2;
                return (
                  <line
                    key={`edge-${graphIndex}-${edgeIndex}`}
                    x1={fromX}
                    y1={fromY}
                    x2={toX}
                    y2={toY}
                    stroke="#334155"
                    strokeWidth={2}
                    opacity={0.4}
                    pointerEvents="none"
                  />
                );
              })}

              <AnimatePresence>
                {visibleVertices.map((vertex) => {
                  const selected = pendingCutSet.some((item) =>
                    isSameVertex(item, vertex),
                  );
                  const baseColor =
                    (vertex.x + vertex.y) % 2 === 0 ? "#1f2937" : "#111827";
                  const localX = (vertex.x - meta.minX) * cellSize;
                  const localY = (vertex.y - meta.minY) * cellSize;
                  const key = `vertex-${vertex.x}-${vertex.y}`;

                  return (
                    <AnimatedVertex
                      key={key}
                      vertex={vertex}
                      localX={localX}
                      localY={localY}
                      cellSize={cellSize}
                      isPendingCut={selected}
                      baseColor={baseColor}
                      splitView={splitView}
                      onClick={
                        splitView
                          ? undefined
                          : (event) =>
                            handleTileClick(graphIndex, vertex, event)
                      }
                    />
                  );
                })}
              </AnimatePresence>
              {splitView ? (
                <rect
                  x={0}
                  y={0}
                  width={layout.width}
                  height={layout.height}
                  fill="transparent"
                  pointerEvents="all"
                  onClick={() => onSelectGraph?.(graphIndex)}
                  style={{ cursor: "pointer" }}
                />
              ) : null}
            </motion.g>
          );
        })}
      </svg>
    );
  },
);

GridVisualizer.displayName = "GridVisualizer";

export default GridVisualizer;
