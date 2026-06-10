import React from 'react';
import './GameSidebar.css';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../state/store';
import { switchActiveGraph } from '../../state/gameSlice';
import { selectActivePalette, setShowGridIndices, setShowCoordinateSystem, setShowGridLines } from '../../state/settingsSlice';
import { MiniGraphPreview } from './MiniGraphPreview';
import { GameStats } from './GameStats';
import { WolfLogo } from '../ui/WolfLogo';

interface GameSidebarProps {
  setIsNewGameModalOpen: (open: boolean) => void;
  topScore: { rank: number } | null;
  isExecuting: boolean;
  splitView: boolean;
  setSplitView: (split: boolean) => void;
}

export const GameSidebar: React.FC<GameSidebarProps> = ({
  setIsNewGameModalOpen,
  topScore,
  isExecuting,
  splitView,
  setSplitView,
}) => {
  const dispatch = useDispatch();
  const { gridSize, bankedGraphs, recentCutGraphs } = useSelector((state: RootState) => state.game);
  const settings = useSelector((state: RootState) => state.settings);
  const activePalette = selectActivePalette({ settings });

  const hasGame = gridSize && gridSize.m > 0 && gridSize.n > 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-header" style={{ marginBottom: '8px' }}>
        <Link to="/" className="logo-text" style={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none', color: 'var(--logo-color)', marginBottom: '24px' }}>
          <WolfLogo size={48} />
          <span style={{ fontFamily: '"Permanent Marker", cursive', fontSize: '3rem', letterSpacing: '0.12rem', textTransform: 'uppercase', lineHeight: 1 }}>HOWL</span>
        </Link>
        <button
          className="btn primary"
          style={{ width: '100%' }}
          onClick={() => setIsNewGameModalOpen(true)}
        >
          New Game
        </button>
      </div>

      <GameStats
        m={hasGame ? gridSize.m : 0}
        n={hasGame ? gridSize.n : 0}
        topScore={topScore}
      />

      {hasGame && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          background: 'var(--bg-card)',
          padding: '12px 16px',
          borderRadius: '12px',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
          marginTop: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', cursor: 'pointer' }} onClick={() => dispatch(setShowGridIndices(!settings.showGridIndices))}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Coordinates</span>
            <div style={{
              width: '36px', height: '20px',
              background: settings.showGridIndices ? 'var(--tile-selected)' : 'var(--bg-inset)',
              borderRadius: '10px', position: 'relative', transition: 'background 0.2s', border: '1px solid var(--border-subtle)'
            }}>
              <div style={{
                width: '16px', height: '16px', background: '#fff', borderRadius: '50%',
                position: 'absolute', top: '1px', left: settings.showGridIndices ? '17px' : '1px',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }} />
            </div>
          </div>
          
          <div style={{ height: '1px', background: 'var(--border-subtle)', width: '100%', opacity: 0.6 }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', cursor: 'pointer' }} onClick={() => dispatch(setShowCoordinateSystem(!settings.showCoordinateSystem))}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Coordinate System</span>
            <div style={{
              width: '36px', height: '20px',
              background: settings.showCoordinateSystem ? 'var(--tile-selected)' : 'var(--bg-inset)',
              borderRadius: '10px', position: 'relative', transition: 'background 0.2s', border: '1px solid var(--border-subtle)'
            }}>
              <div style={{
                width: '16px', height: '16px', background: '#fff', borderRadius: '50%',
                position: 'absolute', top: '1px', left: settings.showCoordinateSystem ? '17px' : '1px',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }} />
            </div>
          </div>

          <div style={{ height: '1px', background: 'var(--border-subtle)', width: '100%', opacity: 0.6 }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', cursor: 'pointer' }} onClick={() => dispatch(setShowGridLines(!settings.showGridLines))}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Grid Lines</span>
            <div style={{
              width: '36px', height: '20px',
              background: settings.showGridLines ? 'var(--tile-selected)' : 'var(--bg-inset)',
              borderRadius: '10px', position: 'relative', transition: 'background 0.2s', border: '1px solid var(--border-subtle)'
            }}>
              <div style={{
                width: '16px', height: '16px', background: '#fff', borderRadius: '50%',
                position: 'absolute', top: '1px', left: settings.showGridLines ? '17px' : '1px',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }} />
            </div>
          </div>
        </div>
      )}

      <div className="sidebar-banked-section">
        <h2 className="section-title">Banked Graphs</h2>
        {bankedGraphs.length === 0 ? (
          <p className="muted">No banked graphs yet.</p>
        ) : (
          <div className="banked-list" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {bankedGraphs.map((graph, index) => (
              <MiniGraphPreview
                key={`banked-${index}`}
                graph={graph}
                palette={activePalette}
                onClick={() => {
                  setSplitView(false);
                  dispatch(switchActiveGraph(index + recentCutGraphs.length));
                }}
                disabled={isExecuting || splitView}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
