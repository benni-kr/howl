import React, { useMemo } from "react";
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
  setSelectedGraphIndex,
  setResetToken,
}) => {
  const dispatch = useDispatch();

  const { solvableTargets, duplicateTargets, subgraphTargets, maxResultingRank, allStrictlyOptimal } = useMemo(() => {
    const solvable: { location: 'active' | 'recent', index?: number, optimalRank: number }[] = [];
    const duplicates: { location: 'active' | 'recent' | 'banked', index?: number }[] = [];
    let currentMaxRank = maxRank;
    let strictlyOptimal = true;

    // 1 & 2 & 3. Gather all candidates for duplicates
    type Candidate = { graph: Graph; location: 'active' | 'recent' | 'banked'; index?: number };
    const allCandidates: Candidate[] = [];
    if (activeGraph) allCandidates.push({ graph: activeGraph, location: 'active' });
    recentCutGraphs.forEach((g, i) => allCandidates.push({ graph: g, location: 'recent', index: i }));
    bankedGraphs.forEach((g, i) => allCandidates.push({ graph: g, location: 'banked', index: i }));

    const hashGroups = new Map<string, Candidate[]>();
    allCandidates.forEach(cand => {
      const fp = getLocalGraphFingerprint(cand.graph);
      const opt = optimalRanks.get(fp);
      const hashToUse = opt?.hash || fp;
      if (!hashGroups.has(hashToUse)) hashGroups.set(hashToUse, []);
      hashGroups.get(hashToUse)!.push(cand);
    });

    const keptCandidates: Candidate[] = [];

    hashGroups.forEach(group => {
      if (group.length > 1) {
        // Sort by baseRank DESCENDING so we KEEP the one with the HIGHEST baseRank (worst).
        // This ensures we never "cheat" by deleting a duplicate that has a worse penalty.
        // If baseRank is the same, we preserve the original order (active -> recent -> banked).
        group.sort((a, b) => b.graph.baseRank - a.graph.baseRank);
        keptCandidates.push(group[0]);
        for (let i = 1; i < group.length; i++) {
          duplicates.push({ location: group[i].location, index: group[i].index });
        }
      } else {
        keptCandidates.push(group[0]);
      }
    });

    // Populate solvable targets based ONLY on kept active/recent candidates
    if (cutsApplied.length > 0) {
      keptCandidates.forEach(cand => {
        if (cand.location === 'banked') return;
        const fp = getLocalGraphFingerprint(cand.graph);
        const opt = optimalRanks.get(fp);
        if (opt && opt.best_rank !== 999999) {
          solvable.push({ location: cand.location, index: cand.index, optimalRank: opt.best_rank });
          currentMaxRank = Math.max(currentMaxRank, cand.graph.baseRank + opt.best_rank);
          if (!opt.is_optimal) strictlyOptimal = false;
        }
      });
    }

    // 4. Subgraph detection
    const subgraphs: { location: 'active' | 'recent', index?: number }[] = [];
    if (cutsApplied.length > 0) {
      const candidates: { graph: Graph, location: 'active' | 'recent', index?: number }[] = [];
      if (activeGraph) candidates.push({ graph: activeGraph, location: 'active' });
      recentCutGraphs.forEach((g, i) => candidates.push({ graph: g, location: 'recent', index: i }));

      const duplicateKeys = new Set(duplicates.map(d => `${d.location}:${d.index ?? 'active'}`));

      for (let i = 0; i < candidates.length; i++) {
        const small = candidates[i];
        for (let j = 0; j < candidates.length; j++) {
          if (i === j) continue;
          const large = candidates[j];
          const largeKey = `${large.location}:${large.index ?? 'active'}`;
          // Don't use a duplicate as a supergraph (it's going to be deleted anyway)
          if (duplicateKeys.has(largeKey)) continue;

          if (small.graph.vertices.length < large.graph.vertices.length &&
              isSubgraphOf(small.graph.vertices, large.graph.vertices)) {
            // ONLY allow deletion if the subgraph (small) has a baseRank <= the supergraph (large)
            // This prevents hiding a worse score by deleting a subgraph that was cut more times.
            if (small.graph.baseRank <= large.graph.baseRank) {
              subgraphs.push({ location: small.location, index: small.index });
              break;
            }
          }
        }
      }
    }

    return {
      solvableTargets: solvable,
      duplicateTargets: duplicates,
      subgraphTargets: subgraphs,
      maxResultingRank: currentMaxRank,
      allStrictlyOptimal: strictlyOptimal
    };
  }, [activeGraph, recentCutGraphs, bankedGraphs, optimalRanks, cutsApplied.length, maxRank]);

  const icon = allStrictlyOptimal ? '🧮' : '🪄';

  if ((solvableTargets.length <= 1 && duplicateTargets.length === 0 && subgraphTargets.length === 0) || isExecuting) {
    return null;
  }

  return (
    <div style={{ position: "absolute", bottom: "-12px", display: "flex", gap: "12px", justifyContent: "center", width: "100%", pointerEvents: "none" }}>
      {duplicateTargets.length > 0 && (
        <button
          className="dynamic-btn"
          style={{ background: rankColorHex, color: "var(--bg-main)" }}
          onClick={() => {
            dispatch(ignoreMultipleGraphs({ targets: duplicateTargets }));
            const stateAfter = store.getState().game;
            if (stateAfter.recentCutGraphs.length > 0) {
              setSelectedGraphIndex(null);
            }
            setResetToken((v) => v + 1);
          }}
        >
          🪞 Delete Duplicates
        </button>
      )}
      {subgraphTargets.length > 0 && (
        <button
          className="dynamic-btn"
          style={{ background: rankColorHex, color: "var(--bg-main)" }}
          onClick={() => {
            dispatch(ignoreMultipleGraphs({ targets: subgraphTargets, actionType: 'subgraph' }));
            const stateAfter = store.getState().game;
            if (stateAfter.recentCutGraphs.length > 0) {
              setSelectedGraphIndex(null);
            }
            setResetToken((v) => v + 1);
          }}
        >
          ⊇ Delete Subgraphs
        </button>
      )}
      {solvableTargets.length > 1 && (
        <button
          className="dynamic-btn"
          style={{ background: rankColorHex, color: "var(--bg-main)" }}
          onClick={() => {
            dispatch(autoSolveMultipleGraphs({ targets: solvableTargets }));
            const stateAfterSolve = store.getState().game;
            if (stateAfterSolve.recentCutGraphs.length > 0) {
              setSelectedGraphIndex(null);
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
