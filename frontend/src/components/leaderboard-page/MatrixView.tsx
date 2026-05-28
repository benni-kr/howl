import React, { useMemo } from 'react';
import { MatrixCellData } from '../../api/api';
import { useAlias } from '../../hooks/useAlias';
import * as math from 'mathjs';

export type MatrixMode = 'min_rank' | 'top_solver' | 'perfection_gap' | 'density_linear' | 'log_adjusted_density' | 'custom_formula';

interface MatrixViewProps {
  data: MatrixCellData[];
  onCellClick: (m: number, n: number) => void;
  mode: MatrixMode;
  customFormula?: string;
}

const getLowerBound = (m: number, n: number) => {
  const minEdge = Math.min(m, n);
  const maxEdge = Math.max(m, n);
  if (minEdge < 5) {
    return Math.floor(Math.log2(maxEdge)) + 1;
  }
  return Math.ceil((5 / 3) * minEdge - (25 / 9));
};

const CELL = 40;     // px per cell
const GAP = 2;       // px gap between cells
const MAX = 100;     // max grid dimension

const MatrixView: React.FC<MatrixViewProps> = ({ data, onCellClick, mode, customFormula = '' }) => {
  const { alias } = useAlias();

  const dataMap = useMemo(() => {
    const map = new Map<string, MatrixCellData>();
    data.forEach(cell => map.set(`${cell.m}-${cell.n}`, cell));
    return map;
  }, [data]);

  const compiledFormula = useMemo(() => {
    if (mode === 'custom_formula' && customFormula.trim() !== '') {
      try {
        return math.compile(customFormula);
      } catch (e) {
        return null;
      }
    }
    return null;
  }, [mode, customFormula]);

  const getCellContent = (m: number, n: number) => {
    const cellData = dataMap.get(`${m}-${n}`);
    if (!cellData) return null;

    let content: React.ReactNode = null;
    let bgColor = 'var(--bg-card)';
    let color = 'var(--text-main)';
    let border = '1px solid var(--border-subtle)';
    let opacity = 1;

    let metricValue: number | string | null = null;
    let lowerBound = getLowerBound(m, n);

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
    } else {
      let goodness = 0;
      const minEdge = Math.min(m, n);
      const maxEdge = Math.max(m, n);

      if (mode === 'perfection_gap') {
        const gap = cellData.min_rank - lowerBound;
        metricValue = gap;
        content = gap;
        // goodness goes down as gap goes up
        goodness = Math.max(0.15, 1 - (gap / (maxEdge * 0.5)));
      } else if (mode === 'density_linear') {
        const density = cellData.min_rank / maxEdge;
        metricValue = density;
        content = density.toFixed(2);
        goodness = Math.max(0.15, 1 - (density / 4.0));
      } else if (mode === 'log_adjusted_density') {
        const density = cellData.min_rank / (minEdge + Math.log2(maxEdge + 1));
        metricValue = density;
        content = density.toFixed(2);
        goodness = Math.max(0.15, 1 - (density / 3.0));
      } else if (mode === 'custom_formula') {
        if (compiledFormula) {
          try {
            const val = compiledFormula.evaluate({
              m,
              n,
              min_edge: minEdge,
              max_edge: maxEdge,
              rank: cellData.min_rank
            });
            metricValue = val;
            content = typeof val === 'number' ? val.toFixed(2) : String(val);
            // simple heuristic for goodness on custom formulas
            goodness = Math.max(0.15, Math.min(1, typeof val === 'number' && !isNaN(val) ? 1 - (val / 10) : 0));
          } catch (e) {
            content = '-';
          }
        } else {
          content = '-';
        }
      }

      bgColor = `color-mix(in srgb, var(--tile-selected) ${Math.round(goodness * 100)}%, var(--bg-card))`;
      opacity = 1;
      color = '#ffffff';
    }

    return { content, bgColor, color, border, opacity, lowerBound, metricValue, minRank: cellData.min_rank, solver: cellData.solver_name };
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
                      cellRender && cellData
                        ? `Grid: ${m}×${n}\nCommunity Rank: ${cellRender.minRank}\nLower Bound: ${cellRender.lowerBound}\nSolver: ${cellRender.solver}${cellRender.metricValue !== null ? `\nMetric Value: ${cellRender.metricValue}` : ''}`
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
