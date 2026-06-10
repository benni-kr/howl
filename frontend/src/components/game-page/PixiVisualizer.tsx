import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSelector } from "react-redux";

import type { Graph, Vertex } from "../../state/gameSlice";
import { SettingsState, selectActivePalette } from "../../state/settingsSlice";

type RootState = {
  game: {
    activeGraph: Graph | null;
    bankedGraphs: Graph[];
    recentCutGraphs: Graph[];
  };
};

export type PixiVisualizerHandle = {
  animateCut: (cutSet: Vertex[]) => Promise<void>;
};

type PixiVisualizerProps = {
  width: number;
  height: number;
  splitView: boolean;
  onSelectGraph?: (index: number) => void;
  selectedGraphIndex?: number | null;
  onPendingCutSetChange: (cutSet: Vertex[]) => void;
  resetToken: number;
  bankedGraphs: Graph[];
  settings: SettingsState;
  isExecuting?: boolean;
  optimalRanks?: Map<string, { best_rank: number, is_optimal: boolean, discovered_by?: string | null, hash: string }>;
  onAutoSolve?: (graphIndex: number) => void;
  onIgnoreDuplicate?: (graphIndex: number) => void;
  hasCutsApplied?: boolean;
  overrideState?: { activeGraph: Graph | null; recentCutGraphs: Graph[] };
  readOnly?: boolean;
  onDeepDiveRequest?: (graphIndex: number) => void;
  overridePendingCutSet?: Vertex[];
  vaporizeActionType?: 'vaporize' | 'ignore' | 'subgraph' | null;
};



const isSameVertex = (a: Vertex, b: Vertex) => a.x === b.x && a.y === b.y;

import { PixiEngine } from "./PixiEngine";

const PixiVisualizer = forwardRef<PixiVisualizerHandle, PixiVisualizerProps>(
  (
    {
      width,
      height,
      splitView,
      onSelectGraph,
      selectedGraphIndex,
      onPendingCutSetChange,
      resetToken,
      bankedGraphs = [],
      settings,
      isExecuting = false,
      optimalRanks = new Map(),
      onAutoSolve,
      onIgnoreDuplicate,
      hasCutsApplied = false,
      overrideState,
      readOnly = false,
      onDeepDiveRequest,
      overridePendingCutSet,
      vaporizeActionType = null,
    },
    ref
  ) => {
    const reduxGameState = useSelector((state: RootState) => state.game);
    const { activeGraph, recentCutGraphs } = overrideState || reduxGameState;
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<PixiEngine | null>(null);
    const [pendingCutSet, setPendingCutSet] = useState<Vertex[]>([]);

    const displayGraphs = useMemo(() => {
      if (recentCutGraphs.length > 0) {
        const graphs = [activeGraph, ...recentCutGraphs];
        return graphs.filter((graph): graph is Graph => Boolean(graph));
      }
      return activeGraph ? [activeGraph] : [];
    }, [activeGraph, recentCutGraphs]);

    const isDraggingRef = useRef(false);
    const dragTargetStateRef = useRef(true);
    const lastClickedVertexRef = useRef<Vertex | null>(null);

    const onNodePointerDown = useCallback((vertex: Vertex, graphIndex: number, shiftKey: boolean) => {
      if (graphIndex !== 0) return;
      isDraggingRef.current = true;

      setPendingCutSet((prev) => {
        let newSet = [...prev];

        if (shiftKey && lastClickedVertexRef.current) {
          // Bresenham's line algorithm
          const x0 = lastClickedVertexRef.current.x;
          const y0 = lastClickedVertexRef.current.y;
          const x1 = vertex.x;
          const y1 = vertex.y;
          
          const dx = Math.abs(x1 - x0);
          const dy = Math.abs(y1 - y0);
          const sx = x0 < x1 ? 1 : -1;
          const sy = y0 < y1 ? 1 : -1;
          let err = dx - dy;
          
          let cx = x0;
          let cy = y0;
          
          const linePoints: Vertex[] = [];
          while (true) {
            linePoints.push({ x: cx, y: cy });
            if (cx === x1 && cy === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) {
              err -= dy;
              cx += sx;
            }
            if (e2 < dx) {
              err += dx;
              cy += sy;
            }
          }

          // Filter linePoints to those that exist in the active graph
          const activeVertices = displayGraphs[0]?.vertices || [];
          const validLinePoints = linePoints.filter((lp) => 
            activeVertices.some((av) => isSameVertex(av, lp))
          );

          // Add all valid points to the selection
          for (const lp of validLinePoints) {
            if (!newSet.some((item) => isSameVertex(item, lp))) {
              newSet.push(lp);
            }
          }
          dragTargetStateRef.current = true; // Dragging from a line selection defaults to selecting
        } else {
          const isSelected = prev.some((item) => isSameVertex(item, vertex));
          dragTargetStateRef.current = !isSelected;
          if (isSelected) {
            newSet = prev.filter((item) => !isSameVertex(item, vertex));
          } else {
            newSet.push(vertex);
          }
        }

        lastClickedVertexRef.current = newSet.length > 0 ? newSet[newSet.length - 1] : null;

        return newSet;
      });
    }, [displayGraphs]);

    const onNodePointerEnter = useCallback((vertex: Vertex, graphIndex: number) => {
      if (graphIndex !== 0 || !isDraggingRef.current) return;
      const forceSelect = dragTargetStateRef.current;
      setPendingCutSet((prev) => {
        const isSelected = prev.some((item) => isSameVertex(item, vertex));
        let newSet = [...prev];
        if (isSelected && !forceSelect) {
          newSet = prev.filter((item) => !isSameVertex(item, vertex));
        } else if (!isSelected && forceSelect) {
          newSet.push(vertex);
        }
        
        lastClickedVertexRef.current = newSet.length > 0 ? newSet[newSet.length - 1] : null;
        
        return newSet;
      });
    }, []);

    const onPointerUp = useCallback(() => {
      isDraggingRef.current = false;
    }, []);

    useEffect(() => {
      if (!containerRef.current) return;
      let isMounted = true;
      const engine = new PixiEngine(containerRef.current);
      engine.init(width, height).then(() => {
        if (!isMounted) return;
        engineRef.current = engine;
        engine.syncState(
          displayGraphs,
          pendingCutSet,
          splitView,
          selectedGraphIndex ?? null,
          width,
          height,
          bankedGraphs,
          selectActivePalette({ settings }),
          optimalRanks,
          onNodePointerDown,
          onNodePointerEnter,
          onPointerUp,
          (graphIndex) => {
            onSelectGraph?.(graphIndex);
          },
          (graphIndex) => {
            onAutoSolve?.(graphIndex);
          },
          (graphIndex) => {
            onIgnoreDuplicate?.(graphIndex);
          },
          isExecuting,
          hasCutsApplied,
          readOnly,
          onDeepDiveRequest,
          vaporizeActionType,
          settings.showGridIndices,
          settings.showCoordinateSystem,
          settings.showGridLines
        );
      });

      return () => {
        isMounted = false;
        engine.destroy();
        engineRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Resize
    useEffect(() => {
      if (engineRef.current) {
        engineRef.current.resize(width, height);
        engineRef.current.syncState(
          displayGraphs,
          overridePendingCutSet || pendingCutSet,
          splitView,
          selectedGraphIndex ?? null,
          width,
          height,
          bankedGraphs,
          selectActivePalette({ settings }),
          optimalRanks,
          onNodePointerDown,
          onNodePointerEnter,
          onPointerUp,
          (graphIndex) => {
            onSelectGraph?.(graphIndex);
          },
          (graphIndex) => {
            onAutoSolve?.(graphIndex);
          },
          (graphIndex) => {
            onIgnoreDuplicate?.(graphIndex);
          },
          isExecuting,
          hasCutsApplied,
          readOnly,
          onDeepDiveRequest,
          vaporizeActionType,
          settings.showGridIndices,
          settings.showCoordinateSystem,
          settings.showGridLines
        );
      }
    }, [width, height, displayGraphs, pendingCutSet, overridePendingCutSet, vaporizeActionType, splitView, selectedGraphIndex, bankedGraphs, settings, optimalRanks, onSelectGraph, onAutoSolve, onIgnoreDuplicate, onNodePointerDown, onNodePointerEnter, onPointerUp, isExecuting, hasCutsApplied, readOnly, onDeepDiveRequest]);

    useEffect(() => {
      onPendingCutSetChange?.(pendingCutSet);
    }, [onPendingCutSetChange, pendingCutSet]);

    useEffect(() => {
      if (resetToken !== undefined) {
        setPendingCutSet([]);
        lastClickedVertexRef.current = null;
      }
    }, [resetToken]);

    useEffect(() => {
      if (splitView) {
        setPendingCutSet([]);
        lastClickedVertexRef.current = null;
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
            // Trigger explosion immediately for cut set by setting them to be removed
            // Wait, they are removed when displayGraphs updates!
            // We just wait a tiny bit to allow the state change to propagate, 
            // or just resolve immediately so Redux removes them and the engine spawns particles automatically!
            setTimeout(resolve, 50);
          }),
      }),
      []
    );

    return (
      <div 
        ref={containerRef} 
        style={{ 
          width, 
          height, 
          background: "transparent", 
          overflow: "hidden", 
          touchAction: "none" 
        }} 
      />
    );
  }
);

PixiVisualizer.displayName = "PixiVisualizer";

export default PixiVisualizer;
