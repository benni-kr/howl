import React, { useMemo } from 'react';
import type { Graph } from '../../state/gameSlice';
import type { Palette } from '../../state/settingsSlice';

interface MiniGraphPreviewProps {
  graph: Graph;
  palette: Palette;
  onClick: () => void;
  disabled?: boolean;
}

export const MiniGraphPreview: React.FC<MiniGraphPreviewProps> = ({ graph, palette, onClick, disabled }) => {
  const { viewBox } = useMemo(() => {
    if (graph.vertices.length === 0) {
      return { viewBox: "0 0 1 1" };
    }
    const xs = graph.vertices.map(v => v.x);
    const ys = graph.vertices.map(v => v.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    // Add some padding to viewBox
    const padding = 0.5;
    const viewBox = `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`;

    return { viewBox };
  }, [graph]);

  return (
    <button
      className="banked-graph-btn btn ghost"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px',
        width: '100%',
        minHeight: '80px',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
      }}
    >
      <div style={{ width: '100%', height: '50px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <svg
          viewBox={viewBox}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            filter: `drop-shadow(0px 2px 4px rgba(0,0,0,0.2))`
          }}
        >
          {graph.vertices.map((v, i) => {
            const isAlternate = (v.x + v.y) % 2 === 1;
            const fill = isAlternate ? palette.tileB : palette.tileA;
            const hexFill = '#' + fill.toString(16).padStart(6, '0');
            const borderFill = '#' + palette.border.toString(16).padStart(6, '0');
            return (
              <rect
                key={i}
                x={v.x + 0.05}
                y={v.y + 0.05}
                width={0.9}
                height={0.9}
                rx={0.15}
                ry={0.15}
                fill={hexFill}
                stroke={borderFill}
                strokeWidth={0.05}
              />
            );
          })}
        </svg>
      </div>
      <div style={{ marginTop: '6px', fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>
        Rank {graph.baseRank}
      </div>
    </button>
  );
};
