import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import MatrixView, { MatrixMode } from '../components/leaderboard-page/MatrixView';
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
const VALID_MODES: MatrixMode[] = ['min_rank', 'top_solver', 'perfection_gap', 'density_linear', 'log_adjusted_density', 'custom_formula'];

const MODE_LABELS: Record<MatrixMode, string> = {
  min_rank: 'Min Rank',
  top_solver: 'Top Solver',
  perfection_gap: 'Perfection Gap',
  density_linear: 'Lin. Density',
  log_adjusted_density: 'Log. Density',
  custom_formula: 'Custom',
};

const LeaderboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { m: mParam, n: nParam } = useParams<{ m: string; n: string }>();
  const [searchParams] = useSearchParams();

  // ── Derive state from URL ──────────────────────────────────────────
  const isDrillDown = !!(mParam && nParam);
  const drillM = isDrillDown ? parseInt(mParam, 10) : null;
  const drillN = isDrillDown ? parseInt(nParam, 10) : null;

  const rawView = searchParams.get('view');
  const activeTab: ViewTab = VALID_VIEWS.includes(rawView as ViewTab)
    ? (rawView as ViewTab)
    : 'matrix';

  const rawMode = searchParams.get('mode');
  const matrixMode: MatrixMode = VALID_MODES.includes(rawMode as MatrixMode)
    ? (rawMode as MatrixMode)
    : 'min_rank';

  const squareOnly = searchParams.get('square') === 'true';

  // ── Data state (still local — it's server data, not UI state) ─────
  const [matrixData, setMatrixData] = useState<MatrixCellData[]>([]);
  const [customFormula, setCustomFormula] = useState<string>('rank - m - n');
  const [showDescriptions, setShowDescriptions] = useState(false);
  const [topSolvers, setTopSolvers] = useState<TopSolverData[]>([]);
  const [gridData, setGridData] = useState<GridLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);

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
    if (isDrillDown) return; // don't fetch when drilling down
    if (activeTab === 'matrix') {
      setLoading(true);
      fetchMatrixLeaderboard().then(data => {
        setMatrixData(data);
        setLoading(false);
      });
    } else {
      setLoading(true);
      fetchTopSolvers(squareOnly).then(data => {
        setTopSolvers(data);
        setLoading(false);
      });
    }
  }, [activeTab, squareOnly, isDrillDown]);

  // ── Navigation helpers ────────────────────────────────────────────
  const setView = useCallback((view: ViewTab) => {
    navigate(`/leaderboard?view=${view}`);
  }, [navigate]);

  const setMode = useCallback((mode: MatrixMode) => {
    navigate(`/leaderboard?view=matrix&mode=${mode}`);
  }, [navigate]);

  const toggleSquare = useCallback(() => {
    const next = !squareOnly;
    navigate(`/leaderboard?view=solvers${next ? '&square=true' : ''}`);
  }, [navigate, squareOnly]);

  const handleCellClick = useCallback((m: number, n: number) => {
    // Preserve current mode in query params for back-nav context
    navigate(`/leaderboard/${m}/${n}?view=matrix&mode=${matrixMode}`);
  }, [navigate, matrixMode]);

  const handleBack = useCallback(() => {
    navigate(`/leaderboard?view=matrix&mode=${matrixMode}`);
  }, [navigate, matrixMode]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header" style={{ paddingBottom: '16px' }}>
        <div className="page-header-controls" style={{ flexWrap: 'wrap', gap: '16px', width: '100%', justifyContent: 'space-between' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 auto', justifyContent: 'flex-end' }}>
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
                maxWidth: '220px'
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
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-subtle)', marginRight: '8px', whiteSpace: 'nowrap' }}>Filter:</div>
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
              <li><strong>Lin. Density:</strong> <code>Min Rank / max(m, n)</code>. Measures how sparse or dense the solution is relative to the largest dimension.</li>
              <li><strong>Log. Density:</strong> <code>Min Rank / (min(m, n) + log2(max(m, n) + 1))</code>. An adjusted density scaling logarithmically with grid size.</li>
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
                <div style={{ padding: '24px 32px' }} className="muted">Loading Matrix...</div>
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
                  />
                </div>
              )
            ) : (
              /* ─── Top Solvers View ─── */
              <div style={{ padding: '24px 32px', height: '100%', overflowY: 'auto' }}>
                {loading && topSolvers.length === 0 ? (
                  <div className="muted">Loading Solvers...</div>
                ) : topSolvers.length > 0 ? (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {topSolvers.map((solver, idx) => {
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
                  <button className="btn ghost" onClick={handleBack} style={{ width: '40px', height: '40px', padding: 0, fontSize: '1.2rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Close">
                    ✕
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }} className="custom-scrollbar">
                  <OnboardingTooltip
                    tutorialKey="hasSeenRunClick"
                    position="fixed-canvas"
                    content="⏪ Tip: Click on any run to watch a step-by-step replay of how this score was achieved!"
                  />

                  {loading ? (
                    <div className="muted">Loading...</div>
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
                                <td style={{ padding: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(entry.created_at))}</td>
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
    </div>
  );
};

export default LeaderboardPage;
