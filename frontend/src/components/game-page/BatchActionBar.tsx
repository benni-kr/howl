import React from "react";
import { useDispatch } from "react-redux";
import { store } from "../../state/store";
import { Graph, getLocalGraphFingerprint, ignoreMultipleGraphs, autoSolveMultipleGraphs } from "../../state/gameSlice";
import { isSubgraphOf } from "../../utils/subgraphUtils";

type OptimalRankMap = Map<string, { best_rank: number, is_optimal: boolean, discovered_by?: string | null, hash: string }>;

type BatchActionBarProps = {
  activeGraph: Graph | null;
  recentCutGraphs: Graph[];
  bankedGraphs: Graph[];
  cutsApplied: any[];
  maxRank: number;
  optimalRanks: OptimalRankMap;
  isExecuting: boolean;
  rankColorHex: string;
  setSplitView: (val: boolean) => void;
  setSelectedGraphIndex: (val: number | null) => void;
  setResetToken: React.Dispatch<React.SetStateAction<number>>;
};

export const BatchActionBar: React.FC<BatchActionBarProps> = ({
  activeGraph,
  recentCutGraphs,
  bankedGraphs,
  cutsApplied,
  maxRank,
  optimalRanks,
  isExecuting,
  rankColorHex,
  setSplitView,
  setSelectedGraphIndex,
  setResetToken,
}) => {
  const dispatch = useDispatch();

  const solvableTargets: { location: 'active' | 'recent', index?: number, optimalRank: number }[] = [];
  const duplicateTargets: { location: 'active' | 'recent' | 'banked', index?: number }[] = [];
  let maxResultingRank = maxRank;
  let allStrictlyOptimal = true;

  const seenHashes = new Set<string>();

  // 1. Process active graph first (highest priority to KEEP)
  if (activeGraph) {
    const fp = getLocalGraphFingerprint(activeGraph);
    const opt = optimalRanks.get(fp);
    const hashToUse = opt?.hash || fp;
    
    seenHashes.add(hashToUse);

    if (opt && cutsApplied.length > 0) {
      if (opt.best_rank !== 999999) {
        solvableTargets.push({ location: 'active', optimalRank: opt.best_rank });
        maxResultingRank = Math.max(maxResultingRank, activeGraph.baseRank + opt.best_rank);
        if (!opt.is_optimal) allStrictlyOptimal = false;
      }
    }
  }

  // 2. Process recent cut graphs (second priority to KEEP)
  recentCutGraphs.forEach((graph, index) => {
    const fp = getLocalGraphFingerprint(graph);
    const opt = optimalRanks.get(fp);
    const hashToUse = opt?.hash || fp;

    if (seenHashes.has(hashToUse)) {
      duplicateTargets.push({ location: 'recent', index });
    } else {
      seenHashes.add(hashToUse);
    }

    if (opt && cutsApplied.length > 0) {
      if (opt.best_rank !== 999999) {
        solvableTargets.push({ location: 'recent', index, optimalRank: opt.best_rank });
        maxResultingRank = Math.max(maxResultingRank, graph.baseRank + opt.best_rank);
        if (!opt.is_optimal) allStrictlyOptimal = false;
      }
    }
  });

  // 3. Process banked graphs (highest priority to DELETE)
  bankedGraphs.forEach((graph, index) => {
    const fp = getLocalGraphFingerprint(graph);
    const opt = optimalRanks.get(fp);
    const hashToUse = opt?.hash || fp;

    if (seenHashes.has(hashToUse)) {
      duplicateTargets.push({ location: 'banked', index });
    } else {
      seenHashes.add(hashToUse);
    }
  });

  // 4. Subgraph detection
  const subgraphTargets: { location: 'active' | 'recent', index?: number }[] = [];
  if (cutsApplied.length > 0) {
    const candidates: { graph: Graph, location: 'active' | 'recent', index?: number }[] = [];
    if (activeGraph) candidates.push({ graph: activeGraph, location: 'active' });
    recentCutGraphs.forEach((g, i) => candidates.push({ graph: g, location: 'recent', index: i }));

    const duplicateKeys = new Set(duplicateTargets.map(d => `${d.location}:${d.index ?? 'active'}`));

    for (let i = 0; i < candidates.length; i++) {
      const small = candidates[i];
      for (let j = 0; j < candidates.length; j++) {
        if (i === j) continue;
        const large = candidates[j];
        const largeKey = `${large.location}:${large.index ?? 'active'}`;
        if (duplicateKeys.has(largeKey)) continue;

        if (small.graph.vertices.length < large.graph.vertices.length &&
            isSubgraphOf(small.graph.vertices, large.graph.vertices)) {
          subgraphTargets.push({ location: small.location, index: small.index });
          break;
        }
      }
    }
  }

  const icon = allStrictlyOptimal ? '🧮' : '🪄';

  if ((solvableTargets.length <= 1 && duplicateTargets.length === 0 && subgraphTargets.length === 0) || isExecuting) {
    return null;
  }

  return (
    <div style={{ position: "absolute", bottom: "-12px", display: "flex", gap: "12px", justifyContent: "center", width: "100%", pointerEvents: "none" }}>
      {duplicateTargets.length > 0 && (
        <button
          className="btn primary"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            borderRadius: "20px",
            background: rankColorHex,
            color: "#1e293b",
            fontWeight: "bold",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            border: "none",
            pointerEvents: "auto",
          }}
          onClick={() => {
            dispatch(ignoreMultipleGraphs({ targets: duplicateTargets }));
            const stateAfter = store.getState().game;
            if (stateAfter.recentCutGraphs.length > 0) {
              setSplitView(true);
              setSelectedGraphIndex(null);
            } else {
              setSplitView(false);
            }
            setResetToken((v) => v + 1);
          }}
        >
          🪞 Delete Duplicates
        </button>
      )}
      {subgraphTargets.length > 0 && (
        <button
          className="btn primary"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            borderRadius: "20px",
            background: rankColorHex,
            color: "#1e293b",
            fontWeight: "bold",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            border: "none",
            pointerEvents: "auto",
          }}
          onClick={() => {
            dispatch(ignoreMultipleGraphs({ targets: subgraphTargets, actionType: 'subgraph' }));
            const stateAfter = store.getState().game;
            if (stateAfter.recentCutGraphs.length > 0) {
              setSplitView(true);
              setSelectedGraphIndex(null);
            } else {
              setSplitView(false);
            }
            setResetToken((v) => v + 1);
          }}
        >
          ⊇ Delete Subgraphs
        </button>
      )}
      {solvableTargets.length > 1 && (
        <button
          className="btn primary"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            borderRadius: "20px",
            background: rankColorHex,
            color: "#1e293b",
            fontWeight: "bold",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            border: "none",
            pointerEvents: "auto",
          }}
          onClick={() => {
            dispatch(autoSolveMultipleGraphs({ targets: solvableTargets }));
            const stateAfterSolve = store.getState().game;
            if (stateAfterSolve.recentCutGraphs.length > 0) {
              setSplitView(true);
              setSelectedGraphIndex(null);
            } else {
              setSplitView(false);
            }
            setResetToken((v) => v + 1);
          }}
        >
          {icon} Auto-Solve All (Max Rank → {maxResultingRank})
        </button>
      )}
    </div>
  );
};
