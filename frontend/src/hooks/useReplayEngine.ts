import { useState, useEffect, useMemo, useCallback } from "react";
import type { Graph, Vertex, Edge, CutHistoryAction } from "../state/gameSlice";
import { executeCutLocal } from "../utils/graphUtils";

export type PlaybackContext = {
  id: string;
  title: string;
  m: number;
  n: number;
  sequence: CutHistoryAction[];
  savedStep: number;
  initialGraph?: Graph;
};

export type EliminationNode = {
  id: string;
  graph: Graph;
  action?: CutHistoryAction;
  children: EliminationNode[];
  isVaporized?: boolean;
  isIgnored?: boolean;
  isSubgraph?: boolean;
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
  
  // The playback stack starts with the Main Run
  const [stack, setStack] = useState<PlaybackContext[]>([]);

  // We sync the initial state dynamically because globalSequence loads asynchronously
  useEffect(() => {
    if (stack.length === 0 && globalSequence.length > 0) {
      setStack([{
        id: "root",
        title: "Main Run",
        m: initialM,
        n: initialN,
        sequence: globalSequence,
        savedStep: 0,
      }]);
    } else if (stack.length > 0 && stack[0].sequence.length === 0 && globalSequence.length > 0) {
      setStack(prev => {
        const newStack = [...prev];
        newStack[0] = { ...newStack[0], sequence: globalSequence, m: initialM, n: initialN };
        return newStack;
      });
    }
  }, [initialM, initialN, globalSequence]);

  const activeContext = useMemo(() => {
    if (stack.length > 0) return stack[stack.length - 1];
    return {
      id: "root",
      title: "Main Run",
      m: initialM,
      n: initialN,
      sequence: globalSequence,
      savedStep: 0,
    };
  }, [stack, initialM, initialN, globalSequence]);

  const totalSteps = activeContext.sequence.length;

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
    let initialGraph: Graph = activeContext.initialGraph
      ? { vertices: [...activeContext.initialGraph.vertices], edges: [...activeContext.initialGraph.edges], baseRank: 0 }
      : buildGridGraph(activeContext.m, activeContext.n);

    let graphs: Graph[] = [initialGraph];
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
      const action = activeContext.sequence[i];
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
        } else if (action.type === "vaporize" || action.type === "ignore" || action.type === "subgraph") {
          // Vaporize/Ignore/Subgraph action means the graph is completely removed
          if (action.type === "vaporize") {
            maxRank = Math.max(maxRank, targetGraph.baseRank + action.optimal_rank);
          }
          graphs.splice(targetIndex, 1);

          if (targetNode) {
            if (action.type === "vaporize") {
              targetNode.isVaporized = true;
            } else if (action.type === "ignore") {
              targetNode.isIgnored = true;
            } else if (action.type === "subgraph") {
              targetNode.isSubgraph = true;
            }
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
      gridSize: { m: activeContext.m, n: activeContext.n },
      cutsApplied,
      treeRoot,
    };
  }, [currentStep, activeContext]);

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const setStep = useCallback((step: number) => {
    setCurrentStep(Math.max(0, Math.min(step, totalSteps)));
    setIsPlaying(false);
  }, [totalSteps]);

  const diveIn = useCallback((title: string, m: number, n: number, sequence: CutHistoryAction[], initialGraph?: Graph) => {
    setIsPlaying(false);
    setStack(prev => {
      const updatedPrev = [...prev];
      if (updatedPrev.length > 0) {
        updatedPrev[updatedPrev.length - 1] = { ...updatedPrev[updatedPrev.length - 1], savedStep: currentStep };
      }
      return [
        ...updatedPrev,
        {
          id: `dive_${Date.now()}`,
          title,
          m,
          n,
          sequence,
          savedStep: 0,
          initialGraph,
        }
      ];
    });
    setCurrentStep(0);
  }, [currentStep]);

  const diveOut = useCallback((targetIndex: number) => {
    setIsPlaying(false);
    setStack(prev => {
      const sliced = prev.slice(0, targetIndex + 1);
      setCurrentStep(sliced[sliced.length - 1].savedStep);
      return sliced;
    });
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
    diveIn,
    diveOut,
    stack,
    activeContext,
  };
};
