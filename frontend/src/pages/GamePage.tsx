import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import "./GamePage.css";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../state/store";
import { store } from "../state/store";

import PixiVisualizer, {
  PixiVisualizerHandle,
} from "../components/game-page/PixiVisualizer";
import VictoryModal from "../components/game-page/VictoryModal";
import { fetchTopScore, submitScore } from "../api/api";

import { isSubgraphOf } from "../utils/subgraphUtils";
import { useShapeCache } from "../hooks/useShapeCache";
import { useCutExecution } from "../hooks/useCutExecution";
import { RankPanel } from "../components/game-page/RankPanel";
import { BatchActionBar } from "../components/game-page/BatchActionBar";
import {
  selectIsGameWon,
  confirmGraphSelection,
  undoCut,
  redoCut,
  autoSolveMultipleGraphs,
  getLocalGraphFingerprint,
} from "../state/gameSlice";
import { useStageSize } from "../hooks/useStageSize";

import type { Vertex, Graph } from "../state/gameSlice";
import { selectActivePalette } from "../state/settingsSlice";
import NewGameModal from "../components/game-page/NewGameModal";
import { useAlias } from "../hooks/useAlias";
import { GameSidebar } from "../components/game-page/GameSidebar";
import { OnboardingTooltip } from "../components/ui/OnboardingTooltip";

const DEBUG_SPAWN_AREA = false;

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
  const { width, height } = useStageSize({ hasSidebar: true });

  const [pendingCutSet, setPendingCutSet] = useState<Vertex[]>([]);
  const [resetToken, setResetToken] = useState(0);

  const [optimalRanks, setOptimalRanks] = useState<Map<string, { best_rank: number, is_optimal: boolean, discovered_by?: string | null, hash: string }>>(new Map());

  const { checkShapesCached, clearCache } = useShapeCache();

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

        submitScore(gridM, gridN, maxRank, solverName, cutsApplied).then(() => {
          // Clear shape cache after successful submission so newly discovered optimal ranks are fetched
          clearCache();
        }).catch(err => {
          console.error("Failed to submit score:", err);
          hasSubmittedScoreRef.current = false;
        });
      }
    } else {
      hasSubmittedScoreRef.current = false;
    }
  }, [isGameWon, activeGraph, recentCutGraphs, bankedGraphs, gridM, gridN, maxRank, solverName, cutsApplied]);

  const { isExecuting, errorMessage, handleCut: execCut } = useCutExecution();
  const [splitView, setSplitView] = useState(() => recentCutGraphs.length > 0);
  const [selectedGraphIndex, setSelectedGraphIndex] = useState<number | null>(null);
  const [isNewGameModalOpen, setIsNewGameModalOpen] = useState(false);

  const [topScore, setTopScore] = useState<{ rank: number; solver_name: string } | null>(null);

  const hasWand = cutsApplied.length > 0 && Array.from(optimalRanks.values()).some(opt => opt.best_rank !== null);
  const hasAbacus = cutsApplied.length > 0 && Array.from(optimalRanks.values()).some(opt => opt.is_optimal);

  const hasSubgraphs = useMemo(() => {
    if (cutsApplied.length === 0) return false;
    const candidates: Graph[] = [];
    if (activeGraph) candidates.push(activeGraph);
    recentCutGraphs.forEach(g => candidates.push(g));
    
    for (let i = 0; i < candidates.length; i++) {
      for (let j = 0; j < candidates.length; j++) {
        if (i === j) continue;
        if (candidates[i].vertices.length < candidates[j].vertices.length &&
            isSubgraphOf(candidates[i].vertices, candidates[j].vertices)) {
          return true;
        }
      }
    }
    return false;
  }, [activeGraph, recentCutGraphs, cutsApplied.length]);

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
    execCut(activeGraph, pendingCutSet, setPendingCutSet, setSplitView, setSelectedGraphIndex, setResetToken);
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

      <main className="main-stage">

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
        {hasSubgraphs && (
          <OnboardingTooltip
            tutorialKey="hasSeenSubgraph"
            position="fixed-canvas"
            content="⊇ Tip: If a shape fits entirely inside another, you only need to solve the larger one. Click 'Delete Subgraphs' to trim it!"
          />
        )}
        {pendingCutSet.length > 0 && !splitView && (
          <OnboardingTooltip
            tutorialKey="hasSeenShiftClick"
            position="fixed-canvas"
            content="📏 Tip: Hold Shift and click another tile to automatically select a straight line between them!"
          />
        )}

        <RankPanel 
          gridSize={gridSize} 
          currentRank={currentRank} 
          maxRank={maxRank} 
          rankColorHex={rankColorHex} 
        />

        {/* Floating single-piece auto-solve button was removed in favor of Magic Wands inside Pixi */}

        <div className="stage-shell" style={DEBUG_SPAWN_AREA ? { border: '2px dashed red' } : undefined}>
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
                dispatch(autoSolveMultipleGraphs({ targets: [{
                  location: graphIndex === 0 ? "active" : "recent",
                  index: graphIndex === 0 ? undefined : graphIndex - 1,
                  optimalRank: opt.best_rank
                }]}));
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
          <BatchActionBar
            activeGraph={activeGraph}
            recentCutGraphs={recentCutGraphs}
            bankedGraphs={bankedGraphs}
            cutsApplied={cutsApplied}
            maxRank={maxRank}
            optimalRanks={optimalRanks}
            isExecuting={isExecuting}
            rankColorHex={rankColorHex}
            setSplitView={setSplitView}
            setSelectedGraphIndex={setSelectedGraphIndex}
            setResetToken={setResetToken}
          />
        </div>

        {errorMessage && <div className="error-toast">{errorMessage}</div>}



        <div className="action-bar">
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

          {!splitView ? (
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
          ) : (
            <button
              className="btn secondary large"
              disabled={selectedGraphIndex === null || isExecuting}
              onClick={handleConfirmSelection}
            >
              Select
            </button>
          )}

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
