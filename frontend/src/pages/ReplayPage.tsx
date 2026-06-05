import React, { useEffect, useState, useRef } from "react";
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

const ActionLog: React.FC<{ sequence: any[], currentStep: number, activeColor: string }> = ({ sequence, currentStep, activeColor }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      const activeEl = container.querySelector('.active-step') as HTMLElement;
      if (activeEl && window.innerWidth > 1024) {
        // Manually scroll only the container so the main window doesn't jump
        const topOffset = activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
        container.scrollTo({
          top: topOffset,
          behavior: 'smooth'
        });
      }
    }
  }, [currentStep]);

  return (
    <div ref={containerRef} className="custom-scrollbar" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1, position: 'relative' }}>
      <div style={{ position: 'sticky', top: 0, background: 'var(--bg-main)', zIndex: 10, padding: '16px 16px 8px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
        <h3 style={{ margin: 0 }}>Action Log</h3>
      </div>
      <div style={{ padding: '8px 16px 16px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {sequence.length === 0 && <div className="muted">No actions recorded.</div>}
        {sequence.map((action, idx) => (
          <div
            key={idx}
            className={idx === currentStep ? 'active-step' : ''}
            style={{
              padding: '12px',
              borderRadius: '8px',
              background: idx < currentStep ? 'var(--bg-card)' : (idx === currentStep ? activeColor : 'var(--bg-inset)'),
              border: `1px solid ${idx === currentStep ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
              opacity: idx <= currentStep ? 1 : 0.5,
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', color: idx === currentStep ? '#000' : 'inherit' }}>
              <span>Step {idx + 1}</span>
              <span style={{
                color: idx === currentStep ? '#000' : (action.type === 'cut' ? 'var(--text-main)' : 'var(--text-highlight)'),
                fontSize: '0.8em',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                {action.type === 'ignore' ? 'duplicate' : action.type}
              </span>
            </div>
            <div style={{ fontSize: '0.9em', color: idx === currentStep ? 'rgba(0,0,0,0.7)' : 'var(--text-muted)', marginTop: '4px' }}>
              {action.type === 'vaporize'
                ? `Optimal Rank: ${action.optimal_rank}`
                : action.type === 'ignore'
                  ? `Duplicate shape trimmed`
                  : action.type === 'subgraph'
                    ? `Subgraph shape trimmed`
                    : `Vertices: ${action.vertices.length}`}
            </div>
          </div>
        ))}
        {sequence.length > 0 && currentStep === sequence.length && (
          <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-highlight)', fontWeight: 'bold' }}>
            ✓ Solved
          </div>
        )}
      </div>
    </div>
  );
};

const useStageSize = (_containerRef: React.RefObject<HTMLDivElement | null>) => {
  const [size, setSize] = useState(() => {
    const isMobile = window.innerWidth <= 1024;
    const w = isMobile
      ? Math.floor(window.innerWidth)
      : Math.max(300, Math.min(1000, Math.floor(window.innerWidth * 0.6)));
    const h = isMobile
      ? w
      : Math.max(300, Math.min(720, window.innerHeight - 230));
    return { width: w, height: h };
  });

  useEffect(() => {
    const update = () => {
      const isMobile = window.innerWidth <= 1024;
      const w = isMobile
        ? Math.floor(window.innerWidth)
        : Math.max(300, Math.min(1000, Math.floor(window.innerWidth * 0.6)));
      const h = isMobile
        ? w
        : Math.max(300, Math.min(720, window.innerHeight - 230));
      setSize({ width: w, height: h });
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return size;
};

export default function ReplayPage() {
  const { m, n, solverName } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const settings = useSelector((state: RootState) => state.settings);
  const activePalette = selectActivePalette({ settings });
  const activeColor = '#' + activePalette.tileA.toString(16).padStart(6, '0');

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useStageSize(canvasContainerRef);

  const mNum = parseInt(m || "0", 10);
  const nNum = parseInt(n || "0", 10);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalSequence, setGlobalSequence] = useState<any[]>([]);
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
            setGlobalSequence(data.cut_sequence as any[]);
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
      if (res && res.best_rank && Array.isArray((res as any).best_cut_sequence)) {
        const seq = decompactSequence((res as any).best_cut_sequence);
        
        // Parse the canonical shape string to reconstruct the exact shape the sequence was built for
        // (We use res.shape_str instead of res.hash since the hash is now MD5)
        const canonicalStr = (res as any).shape_str || "";
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

  if (loading) return <div style={{ padding: '32px' }}>Loading replay...</div>;
  if (error) return <div style={{ padding: '32px', color: 'red' }}>Error: {error}</div>;

  const pendingAction = engine.activeContext.sequence[engine.currentStep];
  const overridePendingCutSet = pendingAction?.type === 'cut' ? (pendingAction?.vertices || []) : [];

  return (
    <div className="replay-page-root">
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '16px 32px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)', flexShrink: 0 }}>
        <div className="replay-header">
          <div>
            <h2 style={{ margin: '0 0 4px 0' }}>Replay: {mNum} &times; {nNum}</h2>
            <div className="muted">Solver: <strong style={{ color: 'var(--text-main)' }}>{solverName}</strong> &bull; Rank: <strong>{rank}</strong></div>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
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
            <button className="btn secondary" onClick={() => navigate(-1)} style={{ width: '36px', height: '36px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px' }} title="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Breadcrumbs */}
        {engine.stack.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '16px', fontSize: '0.9em' }}>
            {engine.stack.map((ctx, idx) => (
              <React.Fragment key={ctx.id}>
                {idx > 0 && <span style={{ color: 'var(--text-muted)' }}>/</span>}
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
              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginLeft: '8px' }}>
                Fetching...
              </span>
            )}
            {diveError && (
              <div style={{ marginLeft: '16px', color: '#f87171', background: 'rgba(248,113,113,0.1)', padding: '4px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
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
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
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
          <div className="custom-scrollbar" style={{ flex: 1, borderTop: '1px solid var(--border-subtle)', overflow: 'auto', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ position: 'sticky', top: 0, left: 0, background: 'var(--bg-main)', zIndex: 10, padding: '16px 16px 8px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Elimination Tree</h3>
              <button className="btn secondary" onClick={() => setIsTreeModalOpen(true)} title="Expand Tree" style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6"></path>
                  <path d="M9 21H3v-6"></path>
                  <path d="M21 3l-7 7"></path>
                  <path d="M3 21l7-7"></path>
                </svg>
              </button>
            </div>
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', minWidth: 'min-content' }}>
              <div className="muted" style={{ fontSize: '0.9em', lineHeight: '1.5', marginBottom: '16px', position: 'sticky', left: '16px' }}>
                Tree depth: <strong>{engine.boardState.maxRank}</strong>
              </div>

              <DynamicEliminationTree rootNode={engine.boardState.treeRoot} />
            </div>
          </div>
        </div>
      </div>

      {/* VCR Toolbar */}
      <div className="replay-toolbar">
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn secondary" onClick={() => engine.setStep(engine.currentStep - 1)} disabled={engine.currentStep === 0} style={{ width: '36px', height: '36px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px' }} title="Previous Step">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="17 19 7 12 17 5 17 19"></polygon>
              <rect x="5" y="5" width="2" height="14"></rect>
            </svg>
          </button>
          <button className="btn primary" onClick={engine.isPlaying ? engine.pause : engine.play} style={{ width: '56px', height: '36px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px' }} title={engine.isPlaying ? "Pause" : "Play"}>
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
          <button className="btn secondary" onClick={() => engine.setStep(engine.currentStep + 1)} disabled={engine.currentStep === engine.totalSteps} style={{ width: '36px', height: '36px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px' }} title="Next Step">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="7 19 17 12 7 5 7 19"></polygon>
              <rect x="17" y="5" width="2" height="14"></rect>
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span className="muted" style={{ fontFamily: 'monospace' }}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="muted" style={{ fontSize: '0.9em' }}>Speed:</span>
          <select
            className="input"
            value={engine.playbackSpeed}
            onChange={(e) => engine.setPlaybackSpeed(parseInt(e.target.value, 10))}
            style={{ padding: '4px 8px' }}
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
            <div style={{ position: 'sticky', top: 0, left: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', zIndex: 10, background: 'var(--bg-main)', paddingBottom: '16px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <h2 style={{ margin: 0 }}>Elimination Tree</h2>
                <div className="muted" style={{ fontSize: '0.9em', marginTop: '8px' }}>Tree depth: <strong>{engine.boardState.maxRank}</strong></div>
              </div>
              <button className="btn secondary" onClick={() => setIsTreeModalOpen(false)}>Close</button>
            </div>
            <div style={{ flex: 1, display: 'flex', minWidth: 'min-content', padding: '16px' }}>
              <DynamicEliminationTree rootNode={engine.boardState.treeRoot} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
