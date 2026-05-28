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

// ─── Valid URL values ────────────────────────────────────────────────
type ViewTab = 'matrix' | 'solvers';
const VALID_VIEWS: ViewTab[] = ['matrix', 'solvers'];
const VALID_MODES: MatrixMode[] = ['min_rank', 'top_solver', 'density_area', 'density_linear'];

const MODE_LABELS: Record<MatrixMode, string> = {
  min_rank: 'Min Rank',
  top_solver: 'Top Solver',
  density_area: 'Density (Area)',
  density_linear: 'Density (Linear)',
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
    : 'solvers';

  const rawMode = searchParams.get('mode');
  const matrixMode: MatrixMode = VALID_MODES.includes(rawMode as MatrixMode)
    ? (rawMode as MatrixMode)
    : 'min_rank';

  const squareOnly = searchParams.get('square') === 'true';

  // ── Data state (still local — it's server data, not UI state) ─────
  const [matrixData, setMatrixData] = useState<MatrixCellData[]>([]);
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
        <div className="page-header-controls" style={{ flexWrap: 'wrap', gap: '8px', width: '100%' }}>
          {/* Main tab toggles */}
          <div className="btn-group" style={{ flexWrap: 'wrap', gap: '4px' }}>
            <button
              className={`btn ${activeTab === 'solvers' && !isDrillDown ? 'primary' : 'secondary'}`}
              onClick={() => setView('solvers')}
            >
              Top Solvers
            </button>
            <button
              className={`btn ${activeTab === 'matrix' || isDrillDown ? 'primary' : 'secondary'}`}
              onClick={() => setView('matrix')}
            >
              The Matrix
            </button>
          </div>

          {/* Matrix mode toggles */}
          {activeTab === 'matrix' && !isDrillDown && (
            <div className="btn-group" style={{ flexWrap: 'wrap', gap: '4px' }}>
              {VALID_MODES.map(m => (
                <button
                  key={m}
                  className={`btn ${matrixMode === m ? 'primary' : 'secondary'}`}
                  onClick={() => setMode(m)}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          )}

          {/* Square-only toggle (replaces checkbox) */}
          {activeTab === 'solvers' && !isDrillDown && (
            <div className="btn-group" style={{ flexWrap: 'wrap', gap: '4px' }}>
              <button
                className={`btn ${!squareOnly ? 'primary' : 'secondary'}`}
                onClick={() => !squareOnly || toggleSquare()}
              >
                All Grids
              </button>
              <button
                className={`btn ${squareOnly ? 'primary' : 'secondary'}`}
                onClick={() => squareOnly || toggleSquare()}
              >
                Square Only
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minWidth: 0, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
          {isDrillDown && drillM && drillN ? (
            /* ─── Drill-Down View ─── */
            <div style={{ padding: '24px 32px', height: '100%', overflowY: 'auto' }}>
              <button className="btn secondary" onClick={handleBack} style={{ marginBottom: '16px' }}>
                &larr; Back to Matrix
              </button>
              <h3 style={{ margin: '0 0 16px 0' }}>Grid {drillM} &times; {drillN} Leaderboard</h3>

              {loading ? (
                <div className="muted">Loading...</div>
              ) : gridData.length > 0 ? (
                <div style={{ width: '100%', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border-subtle)' }}>
                        <th style={{ padding: '12px' }}>Rank</th>
                        <th style={{ padding: '12px' }}>Solver</th>
                        <th style={{ padding: '12px' }}>Achieved Rank</th>
                        <th style={{ padding: '12px' }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gridData.map((entry, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '12px' }}>#{entry.rank_position}</td>
                          <td style={{ padding: '12px', fontWeight: 600 }}>{entry.solver_name}</td>
                          <td style={{ padding: '12px' }}>{entry.achieved_rank}</td>
                          <td style={{ padding: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(entry.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="muted">No records found for this grid yet.</div>
              )}
            </div>

          ) : activeTab === 'matrix' ? (
            /* ─── Matrix View ─── */
            loading && matrixData.length === 0 ? (
              <div style={{ padding: '24px 32px' }} className="muted">Loading Matrix...</div>
            ) : (
              <MatrixView data={matrixData} onCellClick={handleCellClick} mode={matrixMode} />
            )

          ) : (
            /* ─── Top Solvers View ─── */
            <div style={{ padding: '24px 32px', height: '100%', overflowY: 'auto' }}>
              {loading && topSolvers.length === 0 ? (
                <div className="muted">Loading Solvers...</div>
              ) : topSolvers.length > 0 ? (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {topSolvers.map((solver, idx) => (
                    <div key={solver.solver_name} style={{ display: 'flex', alignItems: 'center', padding: '16px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, width: '48px', color: idx < 3 ? 'var(--tile-selected)' : 'var(--text-muted)' }}>
                        #{idx + 1}
                      </div>
                      <div style={{ flex: 1, fontSize: '1.1rem', fontWeight: 600 }}>
                        {solver.solver_name}
                      </div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                        {solver.first_places} <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-muted)' }}>First Places</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">No solvers found.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeaderboardPage;
