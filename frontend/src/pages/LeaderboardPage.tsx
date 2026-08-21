import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import MatrixView, { MatrixMode } from '../components/leaderboard-page/MatrixView';
import { useDispatch } from 'react-redux';
import { initializeGame } from '../state/gameSlice';
import {
  fetchMatrixLeaderboard,
  fetchTopSolvers,
  fetchGridLeaderboard,
  MatrixCellData,
  TopSolverData,
  GridLeaderboardEntry
} from '../api/api';
import { OnboardingTooltip } from '../components/ui/OnboardingTooltip';

// ─── Valid URL values ────────────────────────────────────────────────
type ViewTab = 'matrix' | 'solvers';
const VALID_VIEWS: ViewTab[] = ['matrix', 'solvers'];
const VALID_MODES: MatrixMode[] = ['min_rank', 'top_solver', 'perfection_gap', 'density_linear', 'rank_jump', 'diagonal_jump', 'custom_formula'];

type SolverFilter = 'all' | 'humans' | 'ai';
const VALID_SOLVERS: SolverFilter[] = ['all', 'humans', 'ai'];

const MODE_LABELS: Record<MatrixMode, string> = {
  min_rank: 'Min Rank',
  top_solver: 'Top Solver',
  perfection_gap: 'Perfection Gap',
  density_linear: 'Lin. Density',
  rank_jump: 'Rank Jump',
  diagonal_jump: 'Diag. Jump',
  custom_formula: 'Custom',
};

const SOLVER_LABELS: Record<SolverFilter, string> = {
  all: 'AI & Humans',
  humans: 'Only Humans',
  ai: 'Only AI',
};

const LeaderboardPage: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { m: mParam, n: nParam } = useParams<{ m: string; n: string }>();
  const [searchParams] = useSearchParams();

  // ── Derive state from URL ──────────────────────────────────────────
  const isDrillDown = !!(mParam && nParam);
  const drillM = isDrillDown ? parseInt(mParam, 10) : null;
  const drillN = isDrillDown ? parseInt(nParam, 10) : null;

  const rawView = searchParams.get('view');
  const storedView = localStorage.getItem('howl_leaderboard_view') as ViewTab | null;
  const activeTab: ViewTab = rawView && VALID_VIEWS.includes(rawView as ViewTab)
    ? (rawView as ViewTab)
    : storedView && VALID_VIEWS.includes(storedView)
      ? storedView
      : 'matrix';

  const rawMode = searchParams.get('mode');
  const storedMode = localStorage.getItem('howl_matrix_mode') as MatrixMode | null;
  const matrixMode: MatrixMode = rawMode && VALID_MODES.includes(rawMode as MatrixMode)
    ? (rawMode as MatrixMode)
    : storedMode && VALID_MODES.includes(storedMode)
      ? storedMode
      : 'min_rank';

  const rawSolver = searchParams.get('solver');
  const storedSolver = localStorage.getItem('howl_solver_filter') as SolverFilter | null;
  const solverFilter: SolverFilter = rawSolver && VALID_SOLVERS.includes(rawSolver as SolverFilter)
    ? (rawSolver as SolverFilter)
    : storedSolver && VALID_SOLVERS.includes(storedSolver)
      ? storedSolver
      : 'all';

  const squareOnlyRaw = searchParams.get('square');
  const storedSquareOnly = localStorage.getItem('howl_square_only');
  const squareOnly = squareOnlyRaw !== null 
    ? squareOnlyRaw === 'true' 
    : storedSquareOnly === 'true';

  useEffect(() => {
    localStorage.setItem('howl_leaderboard_view', activeTab);
    localStorage.setItem('howl_matrix_mode', matrixMode);
    localStorage.setItem('howl_solver_filter', solverFilter);
    localStorage.setItem('howl_square_only', String(squareOnly));
  }, [activeTab, matrixMode, solverFilter, squareOnly]);

  // ── Data state (still local — it's server data, not UI state) ─────
  const [matrixData, setMatrixData] = useState<MatrixCellData[]>([]);
  const [customFormula, setCustomFormula] = useState<string>('rank - m - n');
  const [showDescriptions, setShowDescriptions] = useState(false);
  const [topSolvers, setTopSolvers] = useState<TopSolverData[]>([]);
  const [gridData, setGridData] = useState<GridLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [playPopup, setPlayPopup] = useState<{m: number, n: number} | null>(null);

  // ── Data fetching based on URL ────────────────────────────────────
  useEffect(() => {
    if (isDrillDown && drillM && drillN) {
      setLoading(true);
      fetchGridLeaderboard(drillM, drillN).then(data => {
        setGridData(data);
        setLoading(false);
      });
    }
  }, [isDrillDown, drillM, drillN]);

  useEffect(() => {
    if (activeTab === 'matrix') {
      setLoading(true);
      fetchMatrixLeaderboard(solverFilter).then(data => {
        setMatrixData(data);
        setLoading(false);
      });
    } else {
      setLoading(true);
      fetchTopSolvers(squareOnly, solverFilter).then(data => {
        setTopSolvers(data);
        setLoading(false);
      });
    }
  }, [activeTab, squareOnly, solverFilter]);

  // ── Navigation helpers ────────────────────────────────────────────
  const setView = useCallback((view: ViewTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('view', view);
    navigate(`/leaderboard?${params.toString()}`);
  }, [navigate, searchParams]);

  const setMode = useCallback((mode: MatrixMode) => {
    const params = new URLSearchParams(searchParams);
    params.set('view', 'matrix');
    params.set('mode', mode);
    navigate(`/leaderboard?${params.toString()}`);
  }, [navigate, searchParams]);

  const setSolver = useCallback((solver: SolverFilter) => {
    const params = new URLSearchParams(searchParams);
    params.set('solver', solver);
    navigate(`/leaderboard?${params.toString()}`);
  }, [navigate, searchParams]);

  const toggleSquare = useCallback(() => {
    const next = !squareOnly;
    const params = new URLSearchParams(searchParams);
    params.set('view', 'solvers');
    params.set('square', String(next));
    navigate(`/leaderboard?${params.toString()}`);
  }, [navigate, searchParams, squareOnly]);

  const handleCellClick = useCallback((m: number, n: number, hasData: boolean) => {
    // Preserve current mode in query params for back-nav context
    if (hasData) {
      navigate(`/leaderboard/${m}/${n}?view=matrix&mode=${matrixMode}&solver=${solverFilter}`);
    } else {
      setPlayPopup({ m, n });
    }
  }, [navigate, matrixMode, solverFilter]);

  const handleBack = useCallback(() => {
    navigate(`/leaderboard?view=matrix&mode=${matrixMode}&solver=${solverFilter}`);
  }, [navigate, matrixMode, solverFilter]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-controls" style={{ flexWrap: 'wrap', gap: '8px', width: '100%', justifyContent: 'space-between' }}>
          {/* Main tab toggles */}
          <div className="btn-group" style={{ flexWrap: 'wrap', gap: '4px' }}>
            <button
              className={`btn ${activeTab === 'matrix' ? 'primary' : 'secondary'}`}
              onClick={() => setView('matrix')}
            >
              The Matrix
            </button>
            <button
              className={`btn ${activeTab === 'solvers' ? 'primary' : 'secondary'}`}
              onClick={() => setView('solvers')}
            >
              Top Solvers
            </button>
          </div>

          {/* Secondary Controls (Right Aligned) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 auto', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {/* Dropdown 1: Solver Filter (All Players / Only Humans / Only AI) */}
              <div style={{ 
                position: 'relative', 
                display: 'flex', 
                alignItems: 'center', 
                background: 'var(--bg-inset)', 
                border: '1px solid var(--border-subtle)', 
                borderRadius: '8px', 
                padding: '0 12px',
                height: '36px',
                width: '100%',
                maxWidth: '200px'
              }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-subtle)', marginRight: '8px', whiteSpace: 'nowrap' }}>Players:</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {SOLVER_LABELS[solverFilter]}
                </div>
                <select
                  id="solver-filter-select"
                  value={solverFilter}
                  onChange={(e) => setSolver(e.target.value as SolverFilter)}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: 'pointer',
                    appearance: 'none',
                  }}
                >
                  {VALID_SOLVERS.map(s => (
                    <option key={s} value={s}>{SOLVER_LABELS[s]}</option>
                  ))}
                </select>
                <div style={{ pointerEvents: 'none', marginLeft: '8px', fontSize: '10px', color: 'var(--text-subtle)' }}>
                  ▼
                </div>
              </div>

              {/* Dropdown 2: Metric / Grid dropdown */}
              <div style={{ 
                position: 'relative', 
                display: 'flex', 
                alignItems: 'center', 
                background: 'var(--bg-inset)', 
                border: '1px solid var(--border-subtle)', 
                borderRadius: '8px', 
                padding: '0 12px',
                height: '36px',
                width: '100%',
                maxWidth: '200px'
              }}>
                {activeTab === 'matrix' ? (
                  <>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-subtle)', marginRight: '8px', whiteSpace: 'nowrap' }}>Metric:</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {MODE_LABELS[matrixMode]}
                    </div>
                    <select
                      id="metric-select"
                      value={matrixMode}
                      onChange={(e) => setMode(e.target.value as any)}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        opacity: 0,
                        cursor: 'pointer',
                        appearance: 'none',
                      }}
                    >
                      {VALID_MODES.map(m => (
                        <option key={m} value={m}>{MODE_LABELS[m]}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-subtle)', marginRight: '8px', whiteSpace: 'nowrap' }}>Grid:</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {squareOnly ? 'Square Only' : 'All Grids'}
                    </div>
                    <select
                      id="grid-select"
                      value={squareOnly ? 'square' : 'all'}
                      onChange={(e) => {
                        const isSquare = e.target.value === 'square';
                        if (isSquare !== squareOnly) toggleSquare();
                      }}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        opacity: 0,
                        cursor: 'pointer',
                        appearance: 'none',
                      }}
                    >
                      <option value="all">All Grids</option>
                      <option value="square">Square Only</option>
                    </select>
                  </>
                )}
                <div style={{ pointerEvents: 'none', marginLeft: '8px', fontSize: '10px', color: 'var(--text-subtle)' }}>
                  ▼
                </div>
              </div>
              
              {activeTab === 'matrix' && (
                <button 
                  className={`btn ${showDescriptions ? 'primary' : 'secondary'}`}
                  style={{ width: '36px', height: '36px', padding: 0, fontWeight: 'bold', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  onClick={() => setShowDescriptions(!showDescriptions)}
                  title="Toggle metric descriptions"
                >
                  ?
                </button>
              )}
            </div>
          </div>

        {/* Custom formula input */}
        {activeTab === 'matrix' && matrixMode === 'custom_formula' && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' }}>
            <label style={{ fontSize: '14px', color: 'var(--text-subtle)' }}>Formula:</label>
            <input 
              type="text" 
              value={customFormula} 
              onChange={e => setCustomFormula(e.target.value)} 
              style={{ 
                flex: 1, 
                width: '250px', 
                background: 'var(--bg-inset)', 
                border: '1px solid var(--border-subtle)', 
                color: 'var(--text-main)', 
                padding: '4px 8px', 
                borderRadius: '4px',
                fontFamily: 'monospace'
              }} 
            />
          </div>
        )}

        {/* Metric Descriptions */}
        {activeTab === 'matrix' && showDescriptions && (
          <div style={{ 
            marginTop: '12px', 
            padding: '12px', 
            background: 'var(--bg-inset)', 
            borderRadius: '8px', 
            border: '1px solid var(--border-subtle)',
            fontSize: '13px',
            color: 'var(--text-subtle)',
            lineHeight: '1.5'
          }}>
            <strong>Metrics Explained:</strong>
            <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
              <li><strong>Min Rank:</strong> The lowest rank achieved by the community for the given m × n grid.</li>
              <li><strong>Top Solver:</strong> The alias of the player who holds the optimal rank.</li>
              <li><strong>Perfection Gap:</strong> <code>Min Rank - Lower Bound</code>. A lower bound is calculated based on known theoretical limits. 0 means optimal.</li>
              <li><strong>Rank Jump:</strong> <code>min(rank - rank_above, rank - rank_left)</code>. Measures how much a cell's rank exceeds its smaller neighbors. A difference of 3+ strongly suggests the solution is suboptimal.</li>
              <li><strong>Diag. Jump:</strong> <code>rank - rank_top_left</code>. Shows the rank difference to the (m-1, n-1) grid.</li>
              <li><strong>Lin. Density:</strong> <code>Min Rank / max(m, n)</code>. Measures how sparse or dense the solution is relative to the largest dimension.</li>
              <li><strong>Custom:</strong> Enter a valid Math.js expression using: <code>m</code>, <code>n</code>, <code>min_edge</code>, <code>max_edge</code>, and <code>rank</code>. Example: <code>rank - m - n</code>.</li>
            </ul>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minWidth: 0, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          
          {/* Main Content Layer */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            {activeTab === 'matrix' ? (
              /* ─── Matrix View ─── */
              loading && matrixData.length === 0 ? (
                <div style={{ padding: '16px', overflow: 'hidden', height: '100%' }}>
                  <table style={{ borderCollapse: 'separate', borderSpacing: '2px' }}>
                    <tbody>
                      {[...Array(60)].map((_, r) => (
                        <tr key={r}>
                          {r > 0 && <td colSpan={r} style={{ padding: 0, border: 'none' }} />}
                          {[...Array(60 - r)].map((_, c) => (
                            <td key={c} style={{ width: '40px', height: '40px', minWidth: '40px', padding: 0 }}>
                              <div 
                                className="skeleton" 
                                style={{ 
                                  width: '100%', 
                                  height: '100%', 
                                  borderRadius: '4px',
                                  animationDelay: `${(r * 2 + c) * 0.03}s`
                                }} 
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ width: '100%', height: '100%' }}>
                  <OnboardingTooltip
                    tutorialKey="hasSeenMatrixTileClick"
                    position="fixed-canvas"
                    content="👆 Tip: Click on any populated tile to view the detailed leaderboard for that specific grid size!"
                  />
                  <MatrixView 
                    data={matrixData} 
                    onCellClick={handleCellClick} 
                    mode={matrixMode} 
                    customFormula={customFormula}
                    solverFilter={solverFilter}
                  />
                </div>
              )
            ) : (
              /* ─── Top Solvers View ─── */
              <div style={{ padding: '16px', height: '100%', overflowY: 'auto' }}>
                {loading && topSolvers.length === 0 ? (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {[...Array(8)].map((_, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '16px', background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: '12px' }}>
                        <div className="skeleton" style={{ width: '32px', height: '32px', borderRadius: '8px', marginRight: '20px' }} />
                        <div style={{ flex: 1 }}>
                          <div className="skeleton" style={{ width: '150px', height: '20px', marginBottom: '8px' }} />
                          <div className="skeleton" style={{ width: '100px', height: '14px' }} />
                        </div>
                        <div className="skeleton" style={{ width: '60px', height: '24px', borderRadius: '16px' }} />
                      </div>
                    ))}
                  </div>
                ) : topSolvers.length > 0 ? (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {topSolvers.filter(s => s.first_places > 0).map((solver, idx) => {
                      const isFirst = idx === 0;
                      const isSecond = idx === 1;
                      const isThird = idx === 2;
                      
                      let borderStyle = '1px solid var(--border-subtle)';
                      let boxShadow = 'none';
                      if (isFirst) {
                        borderStyle = '1px solid #facc15'; // yellow-400
                        boxShadow = '0 0 15px rgba(250, 204, 21, 0.4)';
                      } else if (isSecond) {
                        borderStyle = '1px solid #94a3b8'; // slate-400
                        boxShadow = '0 0 10px rgba(148, 163, 184, 0.3)';
                      } else if (isThird) {
                        borderStyle = '1px solid #b45309'; // amber-700 / bronze
                        boxShadow = '0 0 10px rgba(180, 83, 9, 0.3)';
                      }

                      return (
                        <div key={solver.solver_name} style={{ display: 'flex', alignItems: 'center', padding: '16px', background: 'var(--bg-card)', border: borderStyle, boxShadow: boxShadow, borderRadius: '12px' }}>
                          <div style={{ fontSize: '1.5rem', fontWeight: 700, width: '48px', color: isFirst ? '#facc15' : isSecond ? '#94a3b8' : isThird ? '#b45309' : 'var(--text-muted)' }}>
                            #{idx + 1}
                          </div>
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                              {solver.solver_name}
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                              Total Grids Solved: {solver.total_grids}
                            </div>
                          </div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, textAlign: 'right' }}>
                            {solver.first_places} <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-muted)' }}>First Places</span>
                          </div>
                        </div>
                      );
                    })}
                    
                    {topSolvers.some(s => s.first_places === 0) && (
                      <div style={{ marginTop: '24px', textAlign: 'center' }}>
                        <h3 style={{ margin: '0 0 16px 0', fontSize: '1.2rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                          Honorable Mentions
                        </h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center', alignItems: 'center', padding: '16px 0' }}>
                          {topSolvers.filter(s => s.first_places === 0).map(solver => {
                            // Deterministic pseudo-random size based on name
                            let hash = 0;
                            for (let i = 0; i < solver.solver_name.length; i++) hash = solver.solver_name.charCodeAt(i) + ((hash << 5) - hash);
                            
                            const size = 100 + (Math.abs(hash) % 40); // 100px to 140px
                            
                            // Organic scattering offsets
                            const mt = Math.abs(hash * 3) % 40;
                            const mb = Math.abs(hash * 7) % 40;
                            
                            return (
                            <div key={solver.solver_name} style={{
                              width: `${size}px`,
                              height: `${size}px`,
                              background: 'var(--bg-card)',
                              border: '1px dashed var(--border-subtle)',
                              borderRadius: '50%',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '8px',
                              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
                              flexShrink: 0,
                              marginTop: `${mt}px`,
                              marginBottom: `${mb}px`
                            }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: `${Math.max(0.85, size / 130)}rem`, textAlign: 'center', wordBreak: 'break-word', lineHeight: 1.1 }}>
                                {solver.solver_name}
                              </span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                                {solver.total_grids} played
                              </span>
                            </div>
                          )})}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="muted">No solvers found.</div>
                )}
              </div>
            )}
          </div>

          {/* Drill-Down Drawer Overlay */}
          <div
            className="drawer-overlay"
            style={{
              transform: isDrillDown ? 'translateX(0)' : 'translateX(100%)',
              boxShadow: isDrillDown ? '-8px 0 32px rgba(0,0,0,0.5)' : 'none',
            }}
          >
            {drillM && drillN && (
              <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0 }}>Grid {drillM} &times; {drillN} Leaderboard</h3>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <button 
                      className="btn primary" 
                      style={{ padding: '6px 16px', fontSize: '0.9rem', borderRadius: '20px', fontWeight: 600 }}
                      onClick={() => {
                        dispatch(initializeGame({ m: drillM, n: drillN }));
                        navigate('/');
                      }}
                    >
                      Play Now
                    </button>
                    <button className="btn ghost" onClick={handleBack} style={{ width: '40px', height: '40px', padding: 0, fontSize: '1.2rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Close">
                      ✕
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }} className="custom-scrollbar">
                  <OnboardingTooltip
                    tutorialKey="hasSeenRunClick"
                    position="fixed-canvas"
                    content="⏪ Tip: Click on any run to watch a step-by-step replay of how this score was achieved!"
                  />

                  {loading ? (
                    <div style={{ width: '100%', overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--border-subtle)' }}>
                              <th style={{ padding: '12px' }}>Rank</th>
                              <th style={{ padding: '12px' }}>Solver</th>
                              <th style={{ padding: '12px' }}>Score</th>
                              <th style={{ padding: '12px' }}>Date</th>
                              <th style={{ padding: '12px' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                          {[...Array(5)].map((_, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td style={{ padding: '12px' }}><div className="skeleton" style={{ height: '20px', width: '40px' }} /></td>
                              <td style={{ padding: '12px' }}><div className="skeleton" style={{ height: '20px', width: '100px' }} /></td>
                              <td style={{ padding: '12px' }}><div className="skeleton" style={{ height: '20px', width: '60px' }} /></td>
                              <td style={{ padding: '12px' }}><div className="skeleton" style={{ height: '20px', width: '120px' }} /></td>
                              <td style={{ padding: '12px' }}><div className="skeleton" style={{ height: '20px', width: '24px', float: 'right' }} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : gridData.length > 0 ? (
                    <div style={{ width: '100%', overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--border-subtle)' }}>
                              <th style={{ padding: '12px' }}>Rank</th>
                              <th style={{ padding: '12px' }}>Solver</th>
                              <th style={{ padding: '12px' }}>Score</th>
                              <th style={{ padding: '12px' }}>Date</th>
                              <th style={{ padding: '12px' }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {gridData.map((entry, idx) => (
                              <tr 
                                key={idx} 
                                style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                                onClick={() => navigate(`/replay/${drillM}/${drillN}/${entry.solver_name}`)}
                                className="hover-row"
                              >
                                <td style={{ padding: '12px' }}>#{entry.rank_position}</td>
                                <td style={{ padding: '12px', fontWeight: 600 }}>{entry.solver_name}</td>
                                <td style={{ padding: '12px' }}>{entry.achieved_rank}</td>
                                <td style={{ padding: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(entry.created_at))}</td>
                                <td style={{ padding: '12px', textAlign: 'right' }}>
                                  <div className="row-action-icon">
                                    ▶
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="muted">No records found for this grid yet.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {playPopup && (
        <div className="modal-overlay" onClick={() => setPlayPopup(null)} style={{ zIndex: 1000 }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: '24px', maxWidth: '320px', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0, marginBottom: '8px', fontSize: '1.5rem' }}>Grid {playPopup.m} &times; {playPopup.n}</h3>
            <p className="muted" style={{ margin: '0 0 24px 0', lineHeight: 1.5 }}>
              No one has solved this grid yet. Do you want to play it and be the first?
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn secondary" style={{ flex: 1 }} onClick={() => setPlayPopup(null)}>Cancel</button>
              <button className="btn primary" style={{ flex: 1 }} onClick={() => {
                dispatch(initializeGame({ m: playPopup.m, n: playPopup.n }));
                navigate('/');
              }}>
                Play Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaderboardPage;
