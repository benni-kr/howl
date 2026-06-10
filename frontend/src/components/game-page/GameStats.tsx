import React from 'react';

interface GameStatsProps {
  m: number;
  n: number;
  topScore: { rank: number } | null;
}

export const GameStats: React.FC<GameStatsProps> = ({ m, n, topScore }) => {
  const hasGame = m > 0 && n > 0;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'var(--bg-card)',
      padding: '16px 20px',
      borderRadius: '16px',
      border: '1px solid var(--border-subtle)',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Grid Size
        </span>
        <span style={{ fontSize: '1.4rem', fontWeight: 800, color: hasGame ? 'var(--text-main)' : 'var(--text-muted)', lineHeight: 1 }}>
          {hasGame ? <>{m} &times; {n}</> : '—'}
        </span>
      </div>
      
      <div style={{ width: '1px', height: '40px', background: 'var(--border-subtle)', opacity: 0.6, margin: '0 16px' }} />
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'right' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Record
        </span>
        <span style={{ fontSize: '1.4rem', fontWeight: 800, color: topScore ? 'var(--tile-selected)' : 'var(--text-muted)', lineHeight: 1 }}>
          {topScore ? topScore.rank : '—'}
        </span>
      </div>
    </div>
  );
};
