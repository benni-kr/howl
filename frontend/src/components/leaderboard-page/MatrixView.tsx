import React, { useMemo } from 'react';
import { MatrixCellData } from '../../api/api';
import { useAlias } from '../../hooks/useAlias';

interface MatrixViewProps {
  data: MatrixCellData[];
  onCellClick: (m: number, n: number) => void;
  mode: 'min_rank' | 'top_solver' | 'density';
}

const MatrixView: React.FC<MatrixViewProps> = ({ data, onCellClick, mode }) => {
  const { alias } = useAlias();

  // Create a lookup map for fast rendering
  const dataMap = useMemo(() => {
    const map = new Map<string, MatrixCellData>();
    data.forEach(cell => {
      map.set(`${cell.m}-${cell.n}`, cell);
    });
    return map;
  }, [data]);

  // Utility to determine cell styling
  const getCellContent = (m: number, n: number) => {
    const cellData = dataMap.get(`${m}-${n}`);
    if (!cellData) return null;

    let content: React.ReactNode = null;
    let bgColor = 'var(--bg-card)';
    let color = 'var(--text-main)';
    let border = '1px solid var(--border-subtle)';
    let opacity = 1;

    if (mode === 'min_rank') {
      content = cellData.min_rank;
      if (cellData.is_optimal) {
        border = '1px solid var(--tile-selected)';
      }
    } else if (mode === 'top_solver') {
      content = cellData.solver_name.substring(0, 3).toUpperCase();
      if (alias && cellData.solver_name.trim().toLowerCase() === alias.trim().toLowerCase()) {
        bgColor = 'var(--tile-selected)';
        color = '#fff';
      }
    } else if (mode === 'density') {
      const density = cellData.min_rank / (m * n);
      content = density.toFixed(2);
      bgColor = 'var(--tile-dark)';
      opacity = Math.max(0.2, Math.min(1, density * 2));
      color = '#fff';
    }

    return { content, bgColor, color, border, opacity };
  };

  const MAX_GRID_SIZE = 100;
  const CELL_SIZE = 40;

  // Generate arrays for mapping
  const mIndices = Array.from({ length: MAX_GRID_SIZE }, (_, i) => i + 1);
  const nIndices = Array.from({ length: MAX_GRID_SIZE }, (_, i) => i + 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minWidth: 0, minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          background: 'var(--bg-inset)',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
        className="hide-scrollbars"
      >
        <div
          style={{
            display: 'grid',
            // We use grid columns 1 through MAX_GRID_SIZE + 1
            gridTemplateColumns: `repeat(${MAX_GRID_SIZE + 1}, ${CELL_SIZE}px)`,
            gridAutoRows: `${CELL_SIZE}px`,
            gap: '2px',
            padding: '16px',
            position: 'relative'
          }}
        >
          {/* Top-Left Empty Corner Cell */}
          <div
            style={{
              gridRow: 1,
              gridColumn: 1,
              position: 'sticky',
              top: 0,
              left: 0,
              zIndex: 20,
              background: 'var(--tile-dark)',
            }}
          />

          {/* Column Headers (m) */}
          {mIndices.map(m => (
            <div
              key={`col-${m}`}
              style={{
                gridRow: 1,
                gridColumn: m + 1,
                position: 'sticky',
                top: 0,
                zIndex: 10,
                background: 'var(--tile-dark)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                color: '#ffffff',
                fontSize: `${CELL_SIZE * 0.3}px`,
              }}
            >
              {m}
            </div>
          ))}

          {/* Row Headers (n) */}
          {nIndices.map(n => (
            <div
              key={`row-${n}`}
              style={{
                gridRow: n + 1,
                gridColumn: 1,
                position: 'sticky',
                left: 0,
                zIndex: 10,
                background: 'var(--tile-dark)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                color: '#ffffff',
                fontSize: `${CELL_SIZE * 0.3}px`,
              }}
            >
              {n}
            </div>
          ))}

          {/* Data Cells (m >= n) */}
          {nIndices.map(n => 
            mIndices.map(m => {
              if (m < n) return null; // Staircase logic

              const cellRender = getCellContent(m, n);
              const cellData = dataMap.get(`${m}-${n}`);

              return (
                <div
                  key={`cell-${m}-${n}`}
                  onClick={() => {
                    if (cellRender) onCellClick(m, n);
                  }}
                  title={cellRender ? `Grid: ${m}x${n}\nRank: ${cellData?.min_rank}\nSolver: ${cellData?.solver_name}` : undefined}
                  style={{
                    gridRow: n + 1,
                    gridColumn: m + 1,
                    background: cellRender ? cellRender.bgColor : 'rgba(0,0,0,0.05)',
                    border: cellRender ? cellRender.border : '1px dashed var(--border-subtle)',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: `${CELL_SIZE * 0.3}px`,
                    fontWeight: 600,
                    color: cellRender ? cellRender.color : 'transparent',
                    opacity: cellRender ? cellRender.opacity : 0.5,
                    boxSizing: 'border-box',
                    cursor: cellRender ? 'pointer' : 'default',
                    transition: 'background 0.2s, color 0.2s, opacity 0.2s',
                  }}
                >
                  {cellRender ? cellRender.content : null}
                </div>
              );
            })
          )}
        </div>
      </div>
      <style>{`
        .hide-scrollbars::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
};

export default MatrixView;
