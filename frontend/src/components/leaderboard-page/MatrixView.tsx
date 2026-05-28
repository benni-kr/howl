import React, { useMemo } from 'react';
import { MatrixCellData } from '../../api/api';
import { useAlias } from '../../hooks/useAlias';

export type MatrixMode = 'min_rank' | 'top_solver' | 'density_area' | 'density_linear';

interface MatrixViewProps {
  data: MatrixCellData[];
  onCellClick: (m: number, n: number) => void;
  mode: MatrixMode;
}

const CELL = 40;     // px per cell
const GAP = 2;       // px gap between cells
const MAX = 100;     // max grid dimension

const MatrixView: React.FC<MatrixViewProps> = ({ data, onCellClick, mode }) => {
  const { alias } = useAlias();

  const dataMap = useMemo(() => {
    const map = new Map<string, MatrixCellData>();
    data.forEach(cell => map.set(`${cell.m}-${cell.n}`, cell));
    return map;
  }, [data]);

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
    } else if (mode === 'density_area' || mode === 'density_linear') {
      const isArea = mode === 'density_area';
      const density = isArea
        ? cellData.min_rank / (m * n)
        : cellData.min_rank / Math.max(m, n);
      content = density.toFixed(2);
      
      // Calculate goodness: 1 is best (lowest density), 0 is worst (highest density)
      // Area density usually stays < 1, linear density can go higher (e.g. up to 2-3).
      const maxExpected = isArea ? 1.5 : 4.0; 
      const goodness = Math.max(0.15, 1 - (density / maxExpected));

      // We want to change the background opacity, not the text opacity.
      // So we apply the alpha directly to the rgba string or use a CSS custom property.
      // Easiest is to keep opacity=1 on the cell, but set bgColor with rgba.
      
      // Let's use a solid color base and calculate rgba for tile-selected
      // tile-selected is a hex variable (like #06b6d4 in green theme), but we can just use an opacity trick by setting the cell background to an rgba overlay on top of the base card.
      
      // Actually, since tile-selected is a hex number in the theme engine, it gets converted to a hex string by the DOM (probably). 
      // A safe way is to just use a solid color and use the cell opacity. Wait, if cell opacity changes, text fades.
      // Let's create the background using color-mix in CSS (supported in all modern browsers).
      bgColor = `color-mix(in srgb, var(--tile-selected) ${Math.round(goodness * 100)}%, var(--bg-card))`;
      opacity = 1; // keep text fully opaque
      color = '#ffffff';
    }

    return { content, bgColor, color, border, opacity };
  };

  const mIndices = useMemo(() => Array.from({ length: MAX }, (_, i) => i + 1), []);
  const nIndices = useMemo(() => Array.from({ length: MAX }, (_, i) => i + 1), []);

  /*
   * We use an HTML <table> instead of CSS Grid because:
   * CSS Grid constrains sticky elements to their row/column track,
   * making `position: sticky` on headers non-functional when rows
   * have fixed heights. Tables don't have this limitation —
   * <th> elements with position:sticky work natively.
   */

  const thStyle: React.CSSProperties = {
    width: CELL,
    height: CELL,
    minWidth: CELL,
    maxWidth: CELL,
    background: 'var(--tile-primary)',
    color: '#ffffff',
    fontWeight: 800,
    fontSize: `${CELL * 0.3}px`,
    textAlign: 'center',
    verticalAlign: 'middle',
    borderRadius: '8px',
    boxSizing: 'border-box',
    padding: 0,
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        background: 'var(--bg-inset)',
      }}
    >
      <table
        style={{
          borderCollapse: 'separate',
          borderSpacing: `${GAP}px`,
        }}
      >
        {/* ── Column Headers ── */}
        <thead>
          <tr>
            {/* Corner cell: sticky to both axes */}
            <th
              style={{
                ...thStyle,
                position: 'sticky',
                top: 0,
                left: 0,
                zIndex: 20,
                boxShadow: '2px 2px 6px rgba(0,0,0,0.35)',
              }}
            />
            {mIndices.map(m => (
              <th
                key={`col-${m}`}
                style={{
                  ...thStyle,
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
                }}
              >
                {m}
              </th>
            ))}
          </tr>
        </thead>

        {/* ── Body: Row headers + ghost tracks + data cells ── */}
        <tbody>
          {nIndices.map(n => (
            <tr key={`row-${n}`}>
              {/* Row header: sticky to left */}
              <th
                style={{
                  ...thStyle,
                  position: 'sticky',
                  left: 0,
                  zIndex: 10,
                  boxShadow: '2px 0 4px rgba(0,0,0,0.25)',
                }}
              >
                {n}
              </th>

              {mIndices.map(m => {
                // Ghost track: faint line across the dead zone
                if (m < n) {
                  return (
                    <td
                      key={`ghost-${m}-${n}`}
                      style={{
                        width: CELL,
                        height: CELL,
                        minWidth: CELL,
                        padding: 0,
                        verticalAlign: 'middle',
                      }}
                    >
                      <div
                        style={{
                          width: '100%',
                          height: '2px', // Make slightly thicker
                          background: 'var(--border-subtle)',
                          opacity: 0.6, // Increase opacity for better visibility
                        }}
                      />
                    </td>
                  );
                }

                // Data cell
                const cellRender = getCellContent(m, n);
                const cellData = dataMap.get(`${m}-${n}`);

                return (
                  <td
                    key={`cell-${m}-${n}`}
                    onClick={() => {
                      if (cellRender) onCellClick(m, n);
                    }}
                    title={
                      cellRender
                        ? `Grid: ${m}×${n}\nRank: ${cellData?.min_rank}\nSolver: ${cellData?.solver_name}`
                        : undefined
                    }
                    style={{
                      width: CELL,
                      height: CELL,
                      minWidth: CELL,
                      padding: 0,
                      background: cellRender ? cellRender.bgColor : 'rgba(0,0,0,0.05)',
                      border: cellRender ? cellRender.border : '1px dashed var(--border-subtle)',
                      borderRadius: '4px',
                      textAlign: 'center',
                      verticalAlign: 'middle',
                      fontSize: `${CELL * 0.3}px`,
                      fontWeight: 600,
                      color: cellRender ? cellRender.color : 'transparent',
                      opacity: cellRender ? cellRender.opacity : 0.5,
                      boxSizing: 'border-box',
                      cursor: cellRender ? 'pointer' : 'default',
                      transition: 'background 0.2s, opacity 0.2s',
                    }}
                  >
                    {cellRender ? cellRender.content : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default MatrixView;
