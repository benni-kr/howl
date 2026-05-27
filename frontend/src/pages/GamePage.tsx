import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../state/store";
import { store } from "../state/store";

import PixiVisualizer, {
  PixiVisualizerHandle,
} from "../components/game-page/PixiVisualizer";
import VictoryModal from "../components/game-page/VictoryModal";
import { executeCut, fetchTopScore, checkShapes, submitScore } from "../api/api";
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
  getLocalGraphFingerprint,
} from "../state/gameSlice";

import type { Vertex } from "../state/gameSlice";
import { selectActivePalette } from "../state/settingsSlice";
import NewGameModal from "../components/game-page/NewGameModal";
import { useAlias } from "../hooks/useAlias";
import { GameSidebar } from "../components/game-page/GameSidebar";

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

  const [optimalRanks, setOptimalRanks] = useState<Map<string, { best_rank: number, is_optimal: boolean }>>(new Map());

  // Poll for optimal ranks when graphs change
  useEffect(() => {
    let isMounted = true;
    const graphsToCheck = [
      ...(activeGraph ? [activeGraph] : []),
      ...recentCutGraphs,
      ...bankedGraphs,
    ];

    if (graphsToCheck.length > 0) {
      checkShapes(graphsToCheck).then((results) => {
        if (!isMounted) return;
        console.log("CheckShapes API response:", results);
        const newRanks = new Map<string, { best_rank: number, is_optimal: boolean }>();
        results.forEach((res, index) => {
          console.log(`Graph ${index} found: ${res.found}, best_rank: ${res.best_rank}, is_optimal: ${res.is_optimal}`);
          if (res.found && res.best_rank !== null) {
            newRanks.set(getLocalGraphFingerprint(graphsToCheck[index]), { best_rank: res.best_rank, is_optimal: !!res.is_optimal });
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
  const [splitView, setSplitView] = useState(false);
  const [selectedGraphIndex, setSelectedGraphIndex] = useState<number | null>(null);
  const [isNewGameModalOpen, setIsNewGameModalOpen] = useState(false);

  const [topScore, setTopScore] = useState<{ rank: number; solver_name: string } | null>(null);

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
      const subgraphs = await executeCut(activeGraph, pendingCutSet);

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
                setResetToken((v) => v + 1);
              }
            }}
            hasCutsApplied={cutsApplied.length > 0}
          />
          {(() => {
            const solvableTargets: { location: 'active' | 'recent', index?: number, optimalRank: number }[] = [];
            let maxResultingRank = maxRank;
            let allStrictlyOptimal = true;

            if (activeGraph) {
              const opt = optimalRanks.get(getLocalGraphFingerprint(activeGraph));
              if (opt && cutsApplied.length > 0) {
                solvableTargets.push({ location: 'active', optimalRank: opt.best_rank });
                maxResultingRank = Math.max(maxResultingRank, activeGraph.baseRank + opt.best_rank);
                if (!opt.is_optimal) allStrictlyOptimal = false;
              }
            }
            recentCutGraphs.forEach((graph, index) => {
              const opt = optimalRanks.get(getLocalGraphFingerprint(graph));
              if (opt && cutsApplied.length > 0) {
                solvableTargets.push({ location: 'recent', index, optimalRank: opt.best_rank });
                maxResultingRank = Math.max(maxResultingRank, graph.baseRank + opt.best_rank);
                if (!opt.is_optimal) allStrictlyOptimal = false;
              }
            });

            const icon = allStrictlyOptimal ? '🔬' : '🪄';

            return (
              solvableTargets.length > 1 && !isExecuting && (
                <div style={{ position: "absolute", bottom: "-12px", display: "flex", justifyContent: "center", width: "100%", pointerEvents: "none" }}>
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
                      setSplitView(false); // Make sure we exit split view if vaporizing everything
                      setResetToken((v) => v + 1);
                    }}
                  >
                    {icon} Auto-Solve All Known Pieces (Max Rank → {maxResultingRank})
                  </button>
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
                disabled={pendingCutSet.length === 0 || isExecuting}
                onClick={handleCut}
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
        />
      )}
    </>
  );
};

export default GamePage;
