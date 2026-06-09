import React from 'react';
import './GameSidebar.css';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../state/store';
import { switchActiveGraph } from '../../state/gameSlice';
import { selectActivePalette } from '../../state/settingsSlice';
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
