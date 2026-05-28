import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { fetchTopScore } from "../api/api";
import { forkGame, GameState } from "../state/gameSlice";
import PixiVisualizer from "../components/game-page/PixiVisualizer";
import { RootState } from "../state/store";
import { useReplayEngine } from "../hooks/useReplayEngine";
import { checkShapes } from "../api/api";
import { selectActivePalette } from "../state/settingsSlice";
import { DynamicEliminationTree } from "../components/game-page/DynamicEliminationTree";

const ActionLog: React.FC<{ sequence: any[], currentStep: number, activeColor: string }> = ({ sequence, currentStep, activeColor }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      const activeEl = containerRef.current.querySelector('.active-step');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
              {action.type}
            </span>
          </div>
          <div style={{ fontSize: '0.9em', color: idx === currentStep ? 'rgba(0,0,0,0.7)' : 'var(--text-muted)', marginTop: '4px' }}>
            {action.type === 'vaporize' 
              ? `Optimal Rank: ${action.optimal_rank}` 
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

const useStageSize = (containerRef: React.RefObject<HTMLDivElement | null>) => {
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        // Debounce or just set directly
        setSize({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height)
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [containerRef]);

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

  const engine = useReplayEngine(mNum, nNum, globalSequence);

  useEffect(() => {
    if (mNum > 0 && nNum > 0 && solverName) {
      setLoading(true);
      fetchTopScore(mNum, nNum, solverName)
        .then(data => {
          if (data && data.cut_sequence) {
            setGlobalSequence(data.cut_sequence as any[]);
            setRank(data.rank);
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

  const handleDeepDiveRequest = async (graphIndex: number) => {
    const targetGraph = engine.boardState.recentCutGraphs[graphIndex - 1] || engine.boardState.activeGraph;
    if (!targetGraph) return;

    // Check if the shape has an optimal sequence
    const results = await checkShapes([targetGraph]);
    const res = results[0];
    if (res && res.best_rank && res.is_optimal && (res as any).best_cut_sequence) {
      // The backend checkShapes needs to return best_cut_sequence!
      // In the previous step, we made checkShapes return `best_cut_sequence`.
      const seq = (res as any).best_cut_sequence;
      // We shift frame of reference: canonical shape is bounded by its width and height.
      const xs = targetGraph.vertices.map(v => v.x);
      const ys = targetGraph.vertices.map(v => v.y);
      const w = Math.max(...xs) - Math.min(...xs) + 1;
      const h = Math.max(...ys) - Math.min(...ys) + 1;
      engine.pushDeepDive({ m: w, n: h, sequence: seq });
    } else {
      alert("No local sequence found for this shape. It might have been solved without a saved sequence.");
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

  const pendingAction = engine.currentFrame.sequence[engine.currentStep];
  const overridePendingCutSet = pendingAction?.vertices || [];

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-main)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 32px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)', flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0' }}>Replay: {mNum} &times; {nNum}</h2>
          <div className="muted">Solver: <strong style={{ color: 'var(--text-main)'}}>{solverName}</strong> &bull; Rank: <strong>{rank}</strong></div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {engine.isDeepDiving && (
            <button className="btn secondary" onClick={engine.popDeepDive}>
              &uarr; Exit Deep Dive
            </button>
          )}
          <button className="btn primary" onClick={handleFork}>
            Fork Run (Take Over)
          </button>
          <button className="btn secondary" onClick={() => navigate(-1)}>Close</button>
        </div>
      </div>

      {/* 3-Pane Layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
        {/* Pane 1: Canvas */}
        <div ref={canvasContainerRef} style={{ flex: 2, position: 'relative', borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-main)', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            <PixiVisualizer 
              width={width}
              height={height}
              splitView={false}
              onPendingCutSetChange={() => {}}
              resetToken={0}
              bankedGraphs={engine.boardState.bankedGraphs}
              settings={settings}
              overrideState={engine.boardState}
              readOnly={true}
              onDeepDiveRequest={handleDeepDiveRequest}
              overridePendingCutSet={overridePendingCutSet}
            />
          </div>
        </div>

        {/* Right Panes */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-main)', minWidth: '300px', maxWidth: '35%', borderLeft: '1px solid var(--border-subtle)' }}>
          {/* Pane 2: Action Log */}
          <ActionLog sequence={engine.currentFrame.sequence} currentStep={engine.currentStep} activeColor={activeColor} />

          {/* Pane 3: Elimination Tree (Dynamic) */}
          <div className="custom-scrollbar" style={{ flex: 1, borderTop: '1px solid var(--border-subtle)', overflow: 'auto', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ position: 'sticky', top: 0, left: 0, background: 'var(--bg-main)', zIndex: 10, padding: '16px 16px 8px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ margin: 0 }}>Elimination Tree</h3>
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
      <div style={{ padding: '16px 32px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: '24px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn secondary" onClick={() => engine.setStep(engine.currentStep - 1)} disabled={engine.currentStep === 0}>
            &#9194; Prev
          </button>
          <button className="btn primary" onClick={engine.isPlaying ? engine.pause : engine.play} style={{ width: '80px' }}>
            {engine.isPlaying ? 'Pause' : 'Play'}
          </button>
          <button className="btn secondary" onClick={() => engine.setStep(engine.currentStep + 1)} disabled={engine.currentStep === engine.totalSteps}>
            Next &#9193;
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
            style={{ flex: 1, cursor: 'pointer' }}
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
    </div>
  );
}
