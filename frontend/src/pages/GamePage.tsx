import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../state/store";
import { store } from "../state/store";

import PixiVisualizer, {
  PixiVisualizerHandle,
} from "../components/game-page/PixiVisualizer";
import VictoryModal from "../components/game-page/VictoryModal";
import { fetchTopScore, submitScore } from "../api/api";
import { executeCutLocal } from "../utils/graphUtils";
import { isSubgraphOf } from "../utils/subgraphUtils";
import { useShapeCache } from "../hooks/useShapeCache";
import {
  applyCutResult,
  removeSolvedSubgraphs,
  selectIsGameWon,
  confirmGraphSelection,
  undoCut,
  redoCut,
  pullFromBankIfNeeded,
  autoSolveGraph,
  autoSolveMultipleGraphs,
  ignoreMultipleGraphs,
  getLocalGraphFingerprint,
} from "../state/gameSlice";

import type { Vertex } from "../state/gameSlice";
import { selectActivePalette } from "../state/settingsSlice";
import NewGameModal from "../components/game-page/NewGameModal";
import { useAlias } from "../hooks/useAlias";
import { GameSidebar } from "../components/game-page/GameSidebar";
import { OnboardingTooltip } from "../components/ui/OnboardingTooltip";

const DEBUG_SPAWN_AREA = false;

const useStageSize = () => {
  const [size, setSize] = useState({ width: 900, height: 640 });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const update = () => {
      const isMobile = window.innerWidth <= 768;
      const sidebarWidth = isMobile ? 0 : 280;
      const verticalReserve = isMobile ? 200 : 230;
      
      const width = Math.max(
        300,
        Math.min(1000, window.innerWidth - sidebarWidth - 48),
      );
      
      // On mobile, the page scrolls normally, so let the height match the width
      // to ensure the grid is as big as possible without artificial vertical constraints.
      const height = isMobile 
        ? width 
        : Math.max(300, Math.min(720, window.innerHeight - verticalReserve));
        
      setSize({ width, height });
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return size;
};

const GamePage: React.FC = () => {
  const dispatch = useDispatch();
  const { activeGraph, bankedGraphs, recentCutGraphs, maxRank, history, futureHistory, gridSize, cutsApplied } =
    useSelector((state: RootState) => state.game);
  const settings = useSelector((state: RootState) => state.settings);
  const activePalette = selectActivePalette({ settings });
  const isGameWon = useSelector((state: RootState) =>
    selectIsGameWon(state.game),
  );

  const currentRank = activeGraph ? activeGraph.baseRank : maxRank;
  const rankColor = settings.mode === "light" ? activePalette.tileB : activePalette.highlight;
  const rankColorHex = '#' + rankColor.toString(16).padStart(6, '0');

  const gridRef = useRef<PixiVisualizerHandle>(null);
  const { width, height } = useStageSize();

  const [pendingCutSet, setPendingCutSet] = useState<Vertex[]>([]);
  const [resetToken, setResetToken] = useState(0);

  const [optimalRanks, setOptimalRanks] = useState<Map<string, { best_rank: number, is_optimal: boolean, discovered_by?: string | null, hash: string }>>(new Map());

  const { checkShapesCached } = useShapeCache();

  // Poll for optimal ranks when graphs change
  useEffect(() => {
    let isMounted = true;
    const graphsToCheck = [
      ...(activeGraph ? [activeGraph] : []),
      ...recentCutGraphs,
      ...bankedGraphs,
    ];

    if (graphsToCheck.length > 0) {
      checkShapesCached(graphsToCheck).then((results) => {
        if (!isMounted) return;
        const newRanks = new Map<string, { best_rank: number, is_optimal: boolean, discovered_by?: string | null, hash: string }>();
        results.forEach((res, index) => {
          if (res.hash) {
            newRanks.set(getLocalGraphFingerprint(graphsToCheck[index]), { 
              best_rank: res.best_rank ?? 999999, 
              is_optimal: !!res.is_optimal, 
              discovered_by: res.discovered_by ?? null,
              hash: res.hash
            });
          }
        });
        setOptimalRanks(newRanks);
      });
    } else {
      setOptimalRanks(new Map());
    }

    return () => {
      isMounted = false;
    };
  }, [activeGraph, recentCutGraphs, bankedGraphs]);

  const hasSubmittedScoreRef = useRef(false);
  const { alias: solverName } = useAlias();
  const gridM = gridSize?.m;
  const gridN = gridSize?.n;

  useEffect(() => {
    if (isGameWon && activeGraph === null && recentCutGraphs.length === 0 && bankedGraphs.length === 0) {
      if (gridM && gridN && solverName && !hasSubmittedScoreRef.current) {
        hasSubmittedScoreRef.current = true;

        submitScore(gridM, gridN, maxRank, solverName, cutsApplied).catch(err => {
          console.error("Failed to submit score:", err);
          hasSubmittedScoreRef.current = false;
        });
      }
    } else {
      hasSubmittedScoreRef.current = false;
    }
  }, [isGameWon, activeGraph, recentCutGraphs, bankedGraphs, gridM, gridN, maxRank, solverName, cutsApplied]);

  const [isExecuting, setIsExecuting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [splitView, setSplitView] = useState(() => recentCutGraphs.length > 0);
  const [selectedGraphIndex, setSelectedGraphIndex] = useState<number | null>(null);
  const [isNewGameModalOpen, setIsNewGameModalOpen] = useState(false);

  const [topScore, setTopScore] = useState<{ rank: number; solver_name: string } | null>(null);

  const hasWand = cutsApplied.length > 0 && Array.from(optimalRanks.values()).some(opt => opt.best_rank !== null);
  const hasAbacus = cutsApplied.length > 0 && Array.from(optimalRanks.values()).some(opt => opt.is_optimal);

  useEffect(() => {
    if (gridSize) {
      fetchTopScore(gridSize.m, gridSize.n).then((data) => {
        if (data) {
          setTopScore({ rank: data.rank, solver_name: data.solver_name });
        } else {
          setTopScore(null);
        }
      });
    }
  }, [gridSize]);

  // Derived state to only show VictoryModal when game is actually completed
  // and we're not just waiting for an execution to finish
  const [hasSolved, setHasSolved] = useState(false);
  useEffect(() => {
    if (isGameWon && !hasSolved && !isExecuting && !isNewGameModalOpen) {
      const timer = setTimeout(() => {
        setHasSolved(true);
      }, 300); // Wait for explosion animations to finish
      return () => clearTimeout(timer);
    }
  }, [isGameWon, hasSolved, isExecuting, isNewGameModalOpen]);

  // Reset split view if there's only one piece (e.g. new game started)
  useEffect(() => {
    if (recentCutGraphs.length === 0) {
      setSplitView(false);
      setSelectedGraphIndex(null);
    }
  }, [recentCutGraphs.length]);

  const handleCut = async () => {
    if (!activeGraph || pendingCutSet.length === 0) return;

    setIsExecuting(true);
    setErrorMessage(null);
    try {
      const subgraphs = executeCutLocal(activeGraph, pendingCutSet);

      // ============================================================================
      // ANIMATION ORCHESTRATION PHASES
      // The cut execution is split into 3 distinct visual phases so that explosions
      // and layout shifts don't overlap, creating a rhythmic, punchy feel.
      // During Phases 1 and 2, `isExecuting` is true, which strictly freezes the
      // PixiVisualizer layout and camera from shifting.
      // ============================================================================

      // PHASE 1: Cut Explosion
      // Apply the cut in Redux. The selected nodes are removed from the graph, causing 
      // them to visually puff up and explode (duration: 0.3s total in PixiVisualizer).
      setPendingCutSet([]);
      dispatch(applyCutResult({ subgraphs, cutSet: pendingCutSet }));

      setTimeout(() => {
        // PHASE 2: 1x1 Subgraph Explosion
        // After the cut nodes have exploded, we look for resulting 1x1 trivial subgraphs.
        const stateBeforeRemove = store.getState().game;
        const has1x1s = stateBeforeRemove.recentCutGraphs.some(g => g.vertices.length <= 1) || (stateBeforeRemove.activeGraph && stateBeforeRemove.activeGraph.vertices.length <= 1);
        const willReplaceFromBank = (stateBeforeRemove.activeGraph && stateBeforeRemove.activeGraph.vertices.length <= 1) && stateBeforeRemove.recentCutGraphs.length === 0 && stateBeforeRemove.bankedGraphs.length > 0;

        // This removes the 1x1 subgraphs from Redux, causing them to explode (duration 0.3s).
        // Note: It purposely DOES NOT pull the replacement banked graph yet so the board clears completely.
        dispatch(removeSolvedSubgraphs());

        const afterPhase2 = () => {
          // PHASE 3: Layout Shift & Bank Replacement
          // Pull from the bank if the board is empty, then unlock the layout.
          dispatch(pullFromBankIfNeeded());

          // Check if we still have multiple non-trivial graphs after removing solved ones
          // If so, enter split view so the user can pick which to keep active
          const stateAfter = store.getState().game;
          if (stateAfter.recentCutGraphs.length > 0) {
            setSplitView(true);
            setSelectedGraphIndex(null);
          }

          setResetToken((value) => value + 1);
          setIsExecuting(false);
        };

        if (has1x1s) {
          // Standard delay is 600ms. If we are pulling a fresh graph from the bank, 
          // we double the delay to 1200ms to let the empty board "breathe" before the replacement arrives.
          const delay = willReplaceFromBank ? 1200 : 600;
          setTimeout(afterPhase2, delay);
        } else {
          // Optimization: Skip the Phase 2 delay entirely if there are no 1x1 blocks to explode.
          afterPhase2();
        }
      }, 600); // 600ms delay gives Phase 1 (Cut Explosion) time to clear before Phase 2 begins.
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "An unexpected error occurred.");
      setIsExecuting(false);
    }
  };

  const handleSelectGraph = useCallback((index: number) => {
    setSelectedGraphIndex(index);
  }, []);

  const handleConfirmSelection = useCallback(() => {
    if (selectedGraphIndex !== null) {
      dispatch(confirmGraphSelection(selectedGraphIndex));
      setSplitView(false);
      setSelectedGraphIndex(null);
      setResetToken((value) => value + 1);
    }
  }, [dispatch, selectedGraphIndex]);

  return (
    <>
      <GameSidebar
        setIsNewGameModalOpen={setIsNewGameModalOpen}
        topScore={topScore}
        isExecuting={isExecuting}
        splitView={splitView}
        setSplitView={setSplitView}
      />

      <main className="main-stage" style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        {/* Onboarding Tooltips */}
        {splitView && (
          <OnboardingTooltip 
            tutorialKey="hasSeenCanvasSelect" 
            position="fixed-canvas"
            content="✂️ Tip: You've split the board! Click on a piece to select which one you want to continue working on, then click 'Select'."
          />
        )}
        {bankedGraphs.length > 0 && (
          <OnboardingTooltip
            tutorialKey="hasSeenBankedGraph"
            position="canvas-left"
            content="🏦 Tip: You have a shape in the bank! You can click on it to swap it with your active board."
          />
        )}
        {hasWand && (
          <OnboardingTooltip 
            tutorialKey="hasSeenVaporize" 
            position="fixed-canvas"
            content="🪄 Tip: The Magic Wand means the community has found a good score for this shape. Click the wand on the board to vaporize the shape and inherit that score!"
          />
        )}
        {hasAbacus && (
          <OnboardingTooltip 
            tutorialKey="hasSeenAbacus" 
            position="fixed-canvas"
            content="🧮 Tip: The Abacus means the score is mathematically perfect. Click it to securely vaporize the shape!"
          />
        )}
        {pendingCutSet.length > 0 && !splitView && (
          <OnboardingTooltip
            tutorialKey="hasSeenShiftClick"
            position="fixed-canvas"
            content="📏 Tip: Hold Shift and click another tile to automatically select a straight line between them!"
          />
        )}

        {gridSize && gridSize.m > 0 && (
          <div
            className="rank-panel"
            style={{
              display: "flex",
              gap: "16px",
              background: "var(--bg-card)",
              padding: "8px 24px",
              borderRadius: "16px",
              border: "1px solid var(--border-subtle)",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
              alignItems: "center",
              minWidth: "280px",
              marginBottom: "24px",
              
              zIndex: 10
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", textAlign: "center" }}>
                Current Rank
              </span>
              <span style={{ fontSize: "24px", fontWeight: 800, color: rankColorHex, lineHeight: 1 }}>
                {currentRank}
              </span>
            </div>
            <div style={{ width: "1px", height: "32px", background: "var(--border-subtle)" }}></div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", textAlign: "center" }}>
                Max Rank
              </span>
              <span style={{ fontSize: "24px", fontWeight: 800, color: "var(--text-main)", lineHeight: 1 }}>
                {maxRank}
              </span>
            </div>
          </div>
        )}

        {/* Floating single-piece auto-solve button was removed in favor of Magic Wands inside Pixi */}

        <div className="stage-shell" style={{ border: DEBUG_SPAWN_AREA ? '2px dashed red' : 'none', display: 'flex', justifyContent: 'center', position: 'relative' }}>
          <PixiVisualizer
            ref={gridRef}
            width={width}
            height={height}
            splitView={splitView}
            selectedGraphIndex={selectedGraphIndex}
            onSelectGraph={handleSelectGraph}
            onPendingCutSetChange={setPendingCutSet}
            resetToken={resetToken}
            bankedGraphs={bankedGraphs}
            settings={settings}
            isExecuting={isExecuting}
            optimalRanks={optimalRanks}
            onAutoSolve={(graphIndex) => {
              const graph = graphIndex === 0 ? activeGraph : recentCutGraphs[graphIndex - 1];
              if (!graph) return;
              const opt = optimalRanks.get(getLocalGraphFingerprint(graph));
              if (opt) {
                dispatch(autoSolveGraph({
                  location: graphIndex === 0 ? "active" : "recent",
                  index: graphIndex === 0 ? undefined : graphIndex - 1,
                  optimalRank: opt.best_rank
                }));
                // After vaporizing, check if multiple subgraphs remain — if so, enter split view
                const stateAfterSolve = store.getState().game;
                if (stateAfterSolve.recentCutGraphs.length > 0) {
                  setSplitView(true);
                  setSelectedGraphIndex(null);
                } else {
                  setSplitView(false);
                }
                setResetToken((v) => v + 1);
              }
            }}
            hasCutsApplied={cutsApplied.length > 0}
          />
          {(() => {
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
                // If it has an optimal rank from a previous discovery, it's solvable
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

            // 4. Subgraph detection: check if any active/recent graph fits inside another
            const subgraphTargets: { location: 'active' | 'recent', index?: number }[] = [];
            if (cutsApplied.length > 0) {
              // Collect all candidate graphs with their location info
              const candidates: { graph: typeof activeGraph, location: 'active' | 'recent', index?: number }[] = [];
              if (activeGraph) candidates.push({ graph: activeGraph, location: 'active' });
              recentCutGraphs.forEach((g, i) => candidates.push({ graph: g, location: 'recent', index: i }));

              // Skip graphs already marked as duplicates
              const duplicateKeys = new Set(duplicateTargets.map(d => `${d.location}:${d.index ?? 'active'}`));

              for (let i = 0; i < candidates.length; i++) {
                const small = candidates[i];
                const smallKey = `${small.location}:${small.index ?? 'active'}`;
                if (duplicateKeys.has(smallKey)) continue; // Already a duplicate, skip

                for (let j = 0; j < candidates.length; j++) {
                  if (i === j) continue;
                  const large = candidates[j];
                  const largeKey = `${large.location}:${large.index ?? 'active'}`;
                  if (duplicateKeys.has(largeKey)) continue;

                  if (small.graph!.vertices.length < large.graph!.vertices.length &&
                      isSubgraphOf(small.graph!.vertices, large.graph!.vertices)) {
                    subgraphTargets.push({ location: small.location, index: small.index });
                    break; // This small graph is a subgraph of at least one larger graph
                  }
                }
              }
            }

            const icon = allStrictlyOptimal ? '🔬' : '🪄';

            return (
              (solvableTargets.length > 1 || duplicateTargets.length > 0 || subgraphTargets.length > 0) && !isExecuting && (
                <div style={{ position: "absolute", bottom: "-12px", display: "flex", gap: "12px", justifyContent: "center", width: "100%", pointerEvents: "none" }}>
                  {subgraphTargets.length > 0 && (
                    <OnboardingTooltip
                      tutorialKey="hasSeenSubgraph"
                      position="fixed-canvas"
                      content="⊇ Tip: If a shape fits entirely inside another, you only need to solve the larger one. Click 'Delete Subgraphs' to trim it!"
                    />
                  )}
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
                        // After batch vaporize, check if unsolved subgraphs remain
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
              )
            );
          })()}
        </div>

        {errorMessage && <div className="error-toast">{errorMessage}</div>}



        <div className="action-bar" style={{ display: 'flex', flexDirection: 'row', gap: '12px', justifyContent: 'center', marginTop: '0px' }}>
          {!splitView ? (
            <>
              <button
                className="btn secondary"
                disabled={history.length === 0 || isExecuting}
                onClick={() => {
                  dispatch(undoCut());
                  setResetToken((v) => v + 1);
                }}
                title="Undo (Ctrl+Z)"
              >
                Undo
              </button>
              <button
                className="btn secondary large"
                disabled={pendingCutSet.length === 0 || (activeGraph && pendingCutSet.length === activeGraph.vertices.length) || isExecuting}
                onClick={handleCut}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  opacity: pendingCutSet.length > 0 ? 1 : 0.5,
                  minWidth: '120px',
                  justifyContent: 'center'
                }}
              >
                Cut
              </button>
              <button
                className="btn secondary"
                disabled={futureHistory.length === 0 || isExecuting}
                onClick={() => {
                  dispatch(redoCut());
                  setResetToken((v) => v + 1);
                }}
                title="Redo (Ctrl+Y)"
              >
                Redo
              </button>
            </>
          ) : (() => {

            return (
              <>
                <button
                  className="btn secondary large"
                  disabled={selectedGraphIndex === null || isExecuting}
                  onClick={handleConfirmSelection}
                >
                  Select
                </button>
              </>
            );
          })()}
        </div>
      </main>

      <NewGameModal
        isOpen={isNewGameModalOpen}
        onClose={(started) => {
          setIsNewGameModalOpen(false);
          if (started) {
            setHasSolved(false); // Reset the won state for the new game
            setTopScore(null); // Clear top score until fetched
            setResetToken((v) => v + 1); // Reset active selections
          } else if (isGameWon) {
            setHasSolved(true);
          }
        }}
      />

      {hasSolved && isGameWon && gridSize && (
        <VictoryModal
          rank={maxRank}
          gridSize={gridSize}
          cutsApplied={cutsApplied}
          oldTopScore={topScore}
          palette={activePalette}
          alias={solverName || "Anonymous"}
          onPlayAgain={() => {
            setHasSolved(false);
            setIsNewGameModalOpen(true);
          }}
          onReviewBoard={() => {
            setHasSolved(false);
            dispatch(undoCut());
            setResetToken((v) => v + 1);
          }}
        />
      )}
    </>
  );
};

export default GamePage;
