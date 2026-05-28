import { useState, useEffect, useMemo, useCallback } from "react";
import type { Graph, Vertex, Edge, CutHistoryAction } from "../state/gameSlice";
import { executeCutLocal } from "../utils/graphUtils";

export type DeepDiveFrame = {
  m: number;
  n: number;
  sequence: CutHistoryAction[];
};

export type EliminationNode = {
  id: string;
  graph: Graph;
  action?: CutHistoryAction;
  children: EliminationNode[];
  isVaporized?: boolean;
};

const buildGridGraph = (m: number, n: number): Graph => {
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];

  for (let x = 0; x < m; x += 1) {
    for (let y = 0; y < n; y += 1) {
      vertices.push({ x, y });
    }
  }

  for (let x = 0; x < m; x += 1) {
    for (let y = 0; y < n; y += 1) {
      const current = { x, y };
      if (x + 1 < m) {
        edges.push({ from: current, to: { x: x + 1, y } });
      }
      if (y + 1 < n) {
        edges.push({ from: current, to: { x, y: y + 1 } });
      }
    }
  }

  return { vertices, edges, baseRank: 0 };
};

const getVertexKey = (v: Vertex) => `${v.x},${v.y}`;

export const useReplayEngine = (initialM: number, initialN: number, globalSequence: CutHistoryAction[]) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1000);
  const [replayStack, setReplayStack] = useState<DeepDiveFrame[]>([]);

  // The active frame is either the top of the deep dive stack or the global frame
  const currentFrame = replayStack.length > 0 
    ? replayStack[replayStack.length - 1] 
    : { m: initialM, n: initialN, sequence: globalSequence };

  const totalSteps = currentFrame.sequence.length;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && currentStep < totalSteps) {
      interval = setInterval(() => {
        setCurrentStep((prev) => prev + 1);
      }, playbackSpeed);
    } else if (currentStep >= totalSteps) {
      setIsPlaying(false);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentStep, totalSteps, playbackSpeed]);

  // Recalculate board state from step 0 to currentStep
  const boardState = useMemo(() => {
    let graphs: Graph[] = [buildGridGraph(currentFrame.m, currentFrame.n)];
    let cutsApplied: CutHistoryAction[] = [];
    let maxRank = 0;

    let treeRoot: EliminationNode = {
      id: "root",
      graph: graphs[0],
      children: []
    };
    let activeNodes: EliminationNode[] = [treeRoot];
    let nextId = 1;

    for (let i = 0; i < currentStep; i++) {
      const action = currentFrame.sequence[i];
      if (!action || !action.vertices || action.vertices.length === 0) continue;

      cutsApplied.push(action);

      // Find the graph that contains the first vertex of this action
      const firstVertexKey = getVertexKey(action.vertices[0]);
      const targetIndex = graphs.findIndex(g => 
        g.vertices.some(v => getVertexKey(v) === firstVertexKey)
      );

      if (targetIndex !== -1) {
        const targetGraph = graphs[targetIndex];

        // Find corresponding leaf node in activeNodes
        const nodeIndex = activeNodes.findIndex(n => 
          n.graph.vertices.some(v => getVertexKey(v) === firstVertexKey)
        );
        const targetNode = activeNodes[nodeIndex];
        if (targetNode) {
          targetNode.action = action;
        }

        if (action.type === "cut") {
          const subgraphs = executeCutLocal(targetGraph, action.vertices);
          const cutSize = targetGraph.vertices.length - subgraphs.reduce((sum, g) => sum + g.vertices.length, 0);
          const newBaseRank = targetGraph.baseRank + cutSize;
          
          const rankedSubgraphs = subgraphs.map(g => ({ ...g, baseRank: newBaseRank }));
          
          // Replace target with new subgraphs
          graphs.splice(targetIndex, 1, ...rankedSubgraphs);

          if (targetNode) {
            targetNode.children = rankedSubgraphs.map(g => ({
              id: `node_${nextId++}`,
              graph: g,
              children: []
            }));
            activeNodes.splice(nodeIndex, 1, ...targetNode.children);
          }
        } else if (action.type === "vaporize") {
          // Vaporize action means the graph is completely removed
          maxRank = Math.max(maxRank, targetGraph.baseRank + action.optimal_rank);
          graphs.splice(targetIndex, 1);

          if (targetNode) {
            targetNode.isVaporized = true;
            activeNodes.splice(nodeIndex, 1);
          }
        }
      }
    }

    // Clean up any 1x1 graphs automatically (like the real engine does)
    const displayGraphs: Graph[] = [];
    for (const g of graphs) {
      if (g.vertices.length === 1) {
        maxRank = Math.max(maxRank, g.baseRank + 1);
      } else {
        displayGraphs.push(g);
      }
    }

    return {
      activeGraph: displayGraphs[0] || null,
      recentCutGraphs: displayGraphs.slice(1),
      bankedGraphs: [], // We treat all displayGraphs as recent for replay rendering
      maxRank,
      gridSize: { m: currentFrame.m, n: currentFrame.n },
      cutsApplied,
      treeRoot,
    };
  }, [currentStep, currentFrame]);

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const setStep = useCallback((step: number) => {
    setCurrentStep(Math.max(0, Math.min(step, totalSteps)));
    setIsPlaying(false);
  }, [totalSteps]);

  const pushDeepDive = useCallback((frame: DeepDiveFrame) => {
    setReplayStack(prev => [...prev, frame]);
    setCurrentStep(0);
    setIsPlaying(false);
  }, []);

  const popDeepDive = useCallback(() => {
    setReplayStack(prev => prev.slice(0, -1));
    setCurrentStep(0);
    setIsPlaying(false);
  }, []);

  return {
    boardState,
    currentStep,
    totalSteps,
    isPlaying,
    playbackSpeed,
    play,
    pause,
    setStep,
    setPlaybackSpeed,
    pushDeepDive,
    popDeepDive,
    isDeepDiving: replayStack.length > 0,
    currentFrame,
  };
};
