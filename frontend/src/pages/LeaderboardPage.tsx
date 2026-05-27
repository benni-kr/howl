import React, { useState, useEffect } from 'react';
import MatrixView from '../components/leaderboard-page/MatrixView';
import {
  fetchMatrixLeaderboard,
  fetchTopSolvers,
  fetchGridLeaderboard,
  MatrixCellData,
  TopSolverData,
  GridLeaderboardEntry
} from '../api/api';

const LeaderboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'matrix' | 'solvers'>('matrix');
  const [matrixMode, setMatrixMode] = useState<'min_rank' | 'top_solver' | 'density'>('min_rank');
  const [matrixData, setMatrixData] = useState<MatrixCellData[]>([]);
  const [topSolvers, setTopSolvers] = useState<TopSolverData[]>([]);
  const [squareOnly, setSquareOnly] = useState(false);
  const [loading, setLoading] = useState(false);

  // Drill-down state
  const [selectedGrid, setSelectedGrid] = useState<{ m: number; n: number } | null>(null);
  const [gridData, setGridData] = useState<GridLeaderboardEntry[]>([]);

  useEffect(() => {
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
  }, [activeTab, squareOnly]);

  useEffect(() => {
    if (selectedGrid) {
      setLoading(true);
      fetchGridLeaderboard(selectedGrid.m, selectedGrid.n).then(data => {
        setGridData(data);
        setLoading(false);
      });
    }
  }, [selectedGrid]);

  const handleCellClick = (m: number, n: number) => {
    setSelectedGrid({ m, n });
  };

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <h2>Leaderboards</h2>
        <div className="page-header-controls">
          <div className="btn-group">
            <button
              className={`btn ${activeTab === 'matrix' ? 'primary' : 'secondary'}`}
              onClick={() => { setActiveTab('matrix'); setSelectedGrid(null); }}
            >
              The Matrix
            </button>
            <button
              className={`btn ${activeTab === 'solvers' ? 'primary' : 'secondary'}`}
              onClick={() => { setActiveTab('solvers'); setSelectedGrid(null); }}
            >
              Top Solvers
            </button>
          </div>

          {activeTab === 'matrix' && !selectedGrid && (
            <div className="btn-group">
              <button className={`btn ${matrixMode === 'min_rank' ? 'primary' : 'secondary'}`} onClick={() => setMatrixMode('min_rank')}>Min Rank</button>
              <button className={`btn ${matrixMode === 'top_solver' ? 'primary' : 'secondary'}`} onClick={() => setMatrixMode('top_solver')}>Top Solver</button>
              <button className={`btn ${matrixMode === 'density' ? 'primary' : 'secondary'}`} onClick={() => setMatrixMode('density')}>Density</button>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          {selectedGrid ? (
            <div style={{ padding: '24px 32px', height: '100%', overflowY: 'auto' }}>
              <button className="btn secondary" onClick={() => setSelectedGrid(null)} style={{ marginBottom: '16px' }}>
                &larr; Back to Matrix
              </button>
              <h3 style={{ margin: '0 0 16px 0' }}>Grid {selectedGrid.m} &times; {selectedGrid.n} Leaderboard</h3>

              {loading ? (
                <div className="muted">Loading...</div>
              ) : gridData.length > 0 ? (
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
                        <td style={{ padding: '12px', color: 'var(--text-muted)' }}>{new Date(entry.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="muted">No records found for this grid yet.</div>
              )}
            </div>
          ) : activeTab === 'matrix' ? (
            loading && matrixData.length === 0 ? (
              <div style={{ padding: '24px 32px' }} className="muted">Loading Matrix...</div>
            ) : (
              <MatrixView data={matrixData} onCellClick={handleCellClick} mode={matrixMode} />
            )
          ) : (
            <div style={{ padding: '24px 32px', height: '100%', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={squareOnly}
                    onChange={(e) => setSquareOnly(e.target.checked)}
                  />
                  Square Grids Only
                </label>
              </div>

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
