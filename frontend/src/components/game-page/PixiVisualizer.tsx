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

const EMPTY_OPTIMAL_RANKS = new Map();

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
      optimalRanks = EMPTY_OPTIMAL_RANKS,
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
    const [isManualCamera, setIsManualCamera] = useState(false);
    const [resetTrigger, setResetTrigger] = useState(0);

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

    const pendingCutRafRef = useRef<number | null>(null);
    const pendingCutUpdatersRef = useRef<((prev: Vertex[]) => Vertex[])[]>([]);

    const setPendingCutThrottled = useCallback((updater: (prev: Vertex[]) => Vertex[]) => {
      pendingCutUpdatersRef.current.push(updater);
      if (pendingCutRafRef.current === null) {
        pendingCutRafRef.current = requestAnimationFrame(() => {
          pendingCutRafRef.current = null;
          const updaters = pendingCutUpdatersRef.current;
          pendingCutUpdatersRef.current = [];
          if (updaters.length > 0) {
            setPendingCutSet(prev => {
              let state = prev;
              for (const u of updaters) {
                state = u(state);
              }
              return state;
            });
          }
        });
      }
    }, []);

    const onNodePointerDown = useCallback((vertex: Vertex, graphIndex: number, shiftKey: boolean) => {
      if (displayGraphs.length > 1 || splitView) {
        onSelectGraph?.(graphIndex);
        return;
      }
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
      setPendingCutThrottled((prev) => {
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
    }, [setPendingCutThrottled]);

    const onPointerUp = useCallback(() => {
      isDraggingRef.current = false;
    }, []);

    useEffect(() => {
      if (!containerRef.current) return;
      let isMounted = true;
      const engine = new PixiEngine(containerRef.current);
      engine.onCameraManualOverride = (isManual) => {
        if (isMounted) setIsManualCamera(isManual);
      };
      engine.init(width, height).then(() => {
        if (!isMounted) return;
        engineRef.current = engine;
        engine.syncState(
          displayGraphs,
          (overridePendingCutSet && overridePendingCutSet.length > 0) ? overridePendingCutSet : pendingCutSet,
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

    const prevSyncParamsRef = useRef<string | null>(null);

    // Resize and Sync
    useEffect(() => {
      if (engineRef.current) {
        const currentParams = {
          width, height,
          displayGraphsCount: displayGraphs.length,
          displayGraphsVerts: displayGraphs.reduce((sum, g) => sum + g.vertices.length, 0),
          pendingCuts: (overridePendingCutSet || pendingCutSet).map(v => `${v.x},${v.y}`).join('|'),
          vaporizeActionType,
          splitView,
          selectedGraphIndex,
          bankedGraphsCount: bankedGraphs.length,
          settings: `${settings.showGridIndices}|${settings.showGridLines}|${settings.showCoordinateSystem}`,
          optimalRanksCount: optimalRanks?.size,
          isExecuting,
          hasCutsApplied,
          readOnly,
          palette: selectActivePalette({ settings })?.tileA, // proxy for palette change
          resetTrigger
        };
        const currentParamsStr = JSON.stringify(currentParams);
        if (prevSyncParamsRef.current === currentParamsStr) {
          return;
        }
        prevSyncParamsRef.current = currentParamsStr;

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
          onSelectGraph,
          onAutoSolve,
          onIgnoreDuplicate,
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
    }, [width, height, displayGraphs, pendingCutSet, overridePendingCutSet, vaporizeActionType, splitView, selectedGraphIndex, bankedGraphs, settings, optimalRanks, isExecuting, hasCutsApplied, readOnly, resetTrigger]);

    // Callback updates
    useEffect(() => {
      if (engineRef.current) {
        engineRef.current.onNodePointerDown = onNodePointerDown;
        engineRef.current.onNodePointerEnter = onNodePointerEnter;
        engineRef.current.onPointerUp = onPointerUp;
        engineRef.current.onGraphClick = onSelectGraph;
        engineRef.current.onAutoSolve = onAutoSolve;
        engineRef.current.onIgnoreDuplicate = onIgnoreDuplicate;
        engineRef.current.onDeepDiveRequest = onDeepDiveRequest;
      }
    }, [onNodePointerDown, onNodePointerEnter, onPointerUp, onSelectGraph, onAutoSolve, onIgnoreDuplicate, onDeepDiveRequest]);

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

    const prevDisplayGraphsRef = useRef<Graph[]>(displayGraphs);

    useEffect(() => {
      const prev = prevDisplayGraphsRef.current;
      const current = displayGraphs;
      
      let shouldReset = false;
      if (current.length === 1) {
        if (prev.length > 1) {
          shouldReset = true;
        } else if (prev.length === 1 && prev[0] !== current[0]) {
          shouldReset = true;
        }
      }

      if (shouldReset && isManualCamera && engineRef.current) {
        engineRef.current.resetCamera();
        setResetTrigger(prevVal => prevVal + 1);
        prevSyncParamsRef.current = null;
        setIsManualCamera(false);
      }

      prevDisplayGraphsRef.current = current;
    }, [displayGraphs, isManualCamera]);



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
      <div style={{ position: "relative", width, height }}>
        <div 
          ref={containerRef} 
          style={{ 
            width: "100%", 
            height: "100%", 
            background: "transparent", 
            overflow: "hidden", 
            touchAction: "none" 
          }} 
        />
        {isManualCamera && (
          <button
            onClick={() => {
              if (engineRef.current) {
                if (engineRef.current.resetCamera()) {
                  // Force a re-layout by changing the trigger
                  setResetTrigger(prev => prev + 1);
                  prevSyncParamsRef.current = null;
                  setIsManualCamera(false);
                }
              }
            }}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              padding: "6px 12px",
              background: "var(--bg-card)",
              color: "var(--text-main)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px",
              zIndex: 10,
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
            }}
          >
            Reset View
          </button>
        )}
      </div>
    );
  }
);

PixiVisualizer.displayName = "PixiVisualizer";

export default PixiVisualizer;
