import React, { useEffect, useState, useRef } from "react";
import "./ReplayPage.css";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { fetchTopScore } from "../api/api";
import { forkGame, GameState } from "../state/gameSlice";
import PixiVisualizer from "../components/game-page/PixiVisualizer";
import { RootState } from "../state/store";
import { useReplayEngine } from "../hooks/useReplayEngine";
import { checkShapes, decompactSequence } from "../api/api";
import { selectActivePalette } from "../state/settingsSlice";
import { DynamicEliminationTree } from "../components/replay-page/DynamicEliminationTree";
import { OnboardingTooltip } from "../components/ui/OnboardingTooltip";

import { ActionLog } from "../components/replay-page/ActionLog";
import { useStageSize } from "../hooks/useStageSize";
import { CutHistoryAction } from "../state/gameSlice";


export default function ReplayPage() {
  const { m, n, solverName } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const settings = useSelector((state: RootState) => state.settings);
  const activePalette = selectActivePalette({ settings });
  const activeColor = '#' + activePalette.tileA.toString(16).padStart(6, '0');

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useStageSize();

  const mNum = parseInt(m || "0", 10);
  const nNum = parseInt(n || "0", 10);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalSequence, setGlobalSequence] = useState<CutHistoryAction[]>([]);
  const [rank, setRank] = useState(0);
  const [isTreeModalOpen, setIsTreeModalOpen] = useState(false);
  const [actualM, setActualM] = useState<number>(mNum);
  const [actualN, setActualN] = useState<number>(nNum);

  const engine = useReplayEngine(actualM, actualN, globalSequence);

  useEffect(() => {
    if (mNum > 0 && nNum > 0 && solverName) {
      setLoading(true);
      fetchTopScore(mNum, nNum, solverName)
        .then(data => {
          if (data && data.cut_sequence) {
            setGlobalSequence(data.cut_sequence);
            setRank(data.rank);
            if (data.m) setActualM(data.m);
            if (data.n) setActualN(data.n);
          } else {
            setError("Could not load replay data.");
          }
          setLoading(false);
        })
        .catch(err => {
          setError(err.message);
          setLoading(false);
        });
    }
  }, [mNum, nNum, solverName]);

  const [isFetchingDive, setIsFetchingDive] = useState(false);
  const [diveError, setDiveError] = useState<string | null>(null);

  const handleDeepDiveRequest = async (graphIndex: number) => {
    if (isFetchingDive) return;
    setDiveError(null);

    const pendingAction = engine.activeContext.sequence[engine.currentStep];
    if (pendingAction?.type !== "vaporize") {
      return; // Only dive into vaporized shapes
    }

    const targetGraph = engine.boardState.recentCutGraphs[graphIndex - 1] || engine.boardState.activeGraph;
    if (!targetGraph) return;

    setIsFetchingDive(true);
    try {
      const results = await checkShapes([targetGraph]);
      const res = results[0];
      if (res && res.best_rank && Array.isArray(res.best_cut_sequence)) {
        const seq = decompactSequence(res.best_cut_sequence);
        
        // Parse the canonical shape string to reconstruct the exact shape the sequence was built for
        // (We use res.shape_str instead of res.hash since the hash is now MD5)
        const canonicalStr = res.shape_str || "";
        const canonicalVertices: { x: number; y: number }[] = canonicalStr.split('|').filter(Boolean).map((pair: string) => {
          const [x, y] = pair.split(',');
          return { x: parseInt(x, 10), y: parseInt(y, 10) };
        });
        
        const w = Math.max(...canonicalVertices.map(v => v.x)) + 1;
        const h = Math.max(...canonicalVertices.map(v => v.y)) + 1;

        // Build the initial graph edges
        const edges: { from: {x: number, y: number}, to: {x: number, y: number} }[] = [];
        const canonicalKeys = new Set(canonicalVertices.map(v => `${v.x},${v.y}`));
        for (const v of canonicalVertices) {
          const right = `${v.x + 1},${v.y}`;
          const down = `${v.x},${v.y + 1}`;
          if (canonicalKeys.has(right)) edges.push({ from: v, to: { x: v.x + 1, y: v.y } });
          if (canonicalKeys.has(down)) edges.push({ from: v, to: { x: v.x, y: v.y + 1 } });
        }

        const initialGraph = {
          vertices: canonicalVertices,
          edges,
          baseRank: 0
        };

        engine.diveIn(`Vaporized ${w}x${h}`, w, h, seq, initialGraph);
      } else {
        setDiveError("No recorded sequence found for this shape. The community has not saved a run for it yet.");
      }
    } catch (e) {
      console.error(e);
      setDiveError("Failed to fetch sequence from the server.");
    } finally {
      setIsFetchingDive(false);
    }
  };

  const handleFork = () => {
    // Dump the current calculated boardState into Redux
    const forkedState: GameState = {
      activeGraph: engine.boardState.activeGraph,
      bankedGraphs: engine.boardState.bankedGraphs,
      recentCutGraphs: engine.boardState.recentCutGraphs,
      maxRank: engine.boardState.maxRank,
      gridSize: engine.boardState.gridSize,
      cutsApplied: engine.boardState.cutsApplied,
      history: [],
      futureHistory: []
    };
    dispatch(forkGame(forkedState));
    navigate("/");
  };

  if (loading) return <div className="replay-page-loading">Loading replay...</div>;
  if (error) return <div className="replay-page-error">Error: {error}</div>;

  const pendingAction = engine.activeContext.sequence[engine.currentStep];
  const overridePendingCutSet = pendingAction?.vertices || [];
  const vaporizeActionType = (pendingAction?.type === 'vaporize' || pendingAction?.type === 'ignore' || pendingAction?.type === 'subgraph') ? pendingAction.type : null;

  return (
    <div className="replay-page-root">
      {/* Header */}
      <div className="replay-header">
        <div className="replay-header">
          <div>
            <h2 className="replay-title">Replay: {mNum} &times; {nNum}</h2>
            <div className="muted">Solver: <strong className="replay-title-highlight">{solverName}</strong> &bull; Rank: <strong>{rank}</strong></div>
          </div>
          <div className="replay-header-row">
            {engine.stack.length === 1 && (
              <button 
                className="btn primary" 
                onClick={handleFork}
                disabled={engine.boardState.activeGraph === null}
                style={engine.boardState.activeGraph === null ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                title={engine.boardState.activeGraph === null ? "Cannot fork a completed run" : "Fork this run"}
              >
                Fork Run
              </button>
            )}
            <button className="btn secondary replay-control-btn" onClick={() => navigate(-1)} title="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Breadcrumbs */}
        {engine.stack.length > 0 && (
          <div className="replay-breadcrumbs">
            {engine.stack.map((ctx, idx) => (
              <React.Fragment key={ctx.id}>
                {idx > 0 && <span className="replay-breadcrumb-separator">/</span>}
                <span 
                  onClick={() => idx < engine.stack.length - 1 && engine.diveOut(idx)}
                  style={{ 
                    cursor: idx < engine.stack.length - 1 ? 'pointer' : 'default',
                    color: idx === engine.stack.length - 1 ? 'var(--text-main)' : 'var(--text-highlight)',
                    fontWeight: idx === engine.stack.length - 1 ? 'bold' : 'normal',
                    textDecoration: idx < engine.stack.length - 1 ? 'underline' : 'none'
                  }}
                >
                  {ctx.title}
                </span>
              </React.Fragment>
            ))}
            {isFetchingDive && (
              <span className="replay-timestamp">
                Fetching...
              </span>
            )}
            {diveError && (
              <div className="replay-is-optimal">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                {diveError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3-Pane Layout */}
      <div className="replay-container" style={{ opacity: isFetchingDive ? 0.6 : 1 }}>
        {/* Pane 1: Canvas */}
        <div ref={canvasContainerRef} className="replay-canvas-pane">
          <div className="replay-main-area">
            <PixiVisualizer
              width={width}
              height={height}
              splitView={false}
              onPendingCutSetChange={() => { }}
              resetToken={0}
              bankedGraphs={engine.boardState.bankedGraphs}
              settings={settings}
              overrideState={engine.boardState}
              readOnly={true}
              onDeepDiveRequest={handleDeepDiveRequest}
              overridePendingCutSet={overridePendingCutSet}
              vaporizeActionType={vaporizeActionType}
            />
            {pendingAction?.type === 'vaporize' && (
              <OnboardingTooltip
                tutorialKey="hasSeenReplayDeepDive"
                position="fixed-canvas"
                content="🤿 Tip: You can click on vaporized blocks to dive deep and see exactly how they were solved!"
              />
            )}
          </div>
        </div>

        {/* Right Panes */}
        <div className="replay-side-pane">
          {/* Pane 2: Action Log */}
          <ActionLog sequence={engine.activeContext.sequence} currentStep={engine.currentStep} activeColor={activeColor} />

          {/* Pane 3: Elimination Tree (Dynamic) */}
          <div className="replay-tree-sidebar custom-scrollbar">
            <div className="replay-tree-header">
              <h3 className="replay-tree-title">Elimination Tree</h3>
              <button className="btn secondary replay-tree-expand-btn" onClick={() => setIsTreeModalOpen(true)} title="Expand Tree">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6"></path>
                  <path d="M9 21H3v-6"></path>
                  <path d="M21 3l-7 7"></path>
                  <path d="M3 21l7-7"></path>
                </svg>
              </button>
            </div>
            <div className="replay-tree-content">
              <div className="replay-tree-help muted">
                Tree depth: <strong>{engine.boardState.maxRank}</strong>
              </div>

              <DynamicEliminationTree rootNode={engine.boardState.treeRoot} />
            </div>
          </div>
        </div>
      </div>

      {/* VCR Toolbar */}
      <div className="replay-toolbar">
        <div className="replay-controls">
          <button className="btn secondary replay-control-btn" onClick={() => engine.setStep(engine.currentStep - 1)} disabled={engine.currentStep === 0} title="Previous Step">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="17 19 7 12 17 5 17 19"></polygon>
              <rect x="5" y="5" width="2" height="14"></rect>
            </svg>
          </button>
          <button className="btn primary replay-play-btn" onClick={engine.isPlaying ? engine.pause : engine.play} title={engine.isPlaying ? "Pause" : "Play"}>
            {engine.isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14"></rect>
                <rect x="14" y="5" width="4" height="14"></rect>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 4 20 12 6 20 6 4"></polygon>
              </svg>
            )}
          </button>
          <button className="btn secondary replay-control-btn" onClick={() => engine.setStep(engine.currentStep + 1)} disabled={engine.currentStep === engine.totalSteps} title="Next Step">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="7 19 17 12 7 5 7 19"></polygon>
              <rect x="17" y="5" width="2" height="14"></rect>
            </svg>
          </button>
        </div>

        <div className="replay-scrubber">
          <span className="replay-step-counter muted">
            {String(engine.currentStep).padStart(2, '0')} / {String(engine.totalSteps).padStart(2, '0')}
          </span>
          <input
            type="range"
            min={0}
            max={engine.totalSteps}
            value={engine.currentStep}
            onChange={(e) => engine.setStep(parseInt(e.target.value, 10))}
            style={{ flex: 1, cursor: 'pointer', accentColor: activeColor }}
          />
        </div>

        <div className="replay-speed-controls">
          <span className="replay-speed-label muted">Speed:</span>
          <select
            className="input replay-speed-btn"
            value={engine.playbackSpeed}
            onChange={(e) => engine.setPlaybackSpeed(parseInt(e.target.value, 10))}
          >
            <option value={2000}>0.5x</option>
            <option value={1000}>1.0x</option>
            <option value={500}>2.0x</option>
            <option value={200}>5.0x</option>
          </select>
        </div>
      </div>

      {/* Tree Modal */}
      {isTreeModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTreeModalOpen(false)} style={{ zIndex: 1000 }}>
          <div 
            className="modal-content custom-scrollbar" 
            onClick={e => e.stopPropagation()} 
            style={{ 
              width: '90vw', 
              height: '90vh', 
              maxWidth: 'none', 
              overflow: 'auto', 
              display: 'flex', 
              flexDirection: 'column', 
              background: 'var(--bg-main)' 
            }}
          >
            <div className="replay-tree-modal-header">
              <div>
                <h2 className="replay-tree-title">Elimination Tree</h2>
                <div className="replay-tree-modal-depth muted">Tree depth: <strong>{engine.boardState.maxRank}</strong></div>
              </div>
              <button className="btn secondary" onClick={() => setIsTreeModalOpen(false)}>Close</button>
            </div>
            <div className="replay-tree-modal-content">
              <DynamicEliminationTree rootNode={engine.boardState.treeRoot} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
