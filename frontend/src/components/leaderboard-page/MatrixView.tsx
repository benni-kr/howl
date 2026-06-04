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

const getLowerBound = (m: number, n: number): number => {
  const min = Math.min(m, n);
  const max = Math.max(m, n);

  // Guard clause to prevent recursive collapse
  if (min <= 0) return 0;

  // 1 x n Grids (Path graphs) - Exact rank number
  if (min === 1) {
    return Math.floor(Math.log2(max)) + 1;
  }

  // 2 x n Grids (Ladder graphs) - Recursive exact lower bound
  if (min === 2) {
    if (max === 2) return 3;
    return 2 + getLowerBound(2, Math.ceil((max - 2) / 2));
  }

  // 3 x n Grids - Recursive lower bound
  if (min === 3) {
    if (max === 2) return 4;
    if (max === 3) return 5;
    return 3 + getLowerBound(3, Math.ceil((max - 3) / 2));
  }

  // 4 x n Grids - Recursive lower bound
  if (min === 4) {
    if (max === 2) return 4; // Safely caught here if passed out of order
    if (max === 3) return 6;
    if (max === 4) return 7;
    if (max === 5) return 8;
    return 4 + getLowerBound(4, Math.ceil((max - 4) / 2));
  }

  // General m x n Grids (where m >= 5)
  // Bound 1: The explicit linear lower bound for square grids
  const squareBound = Math.ceil((5 / 3) * min - (25 / 9));

  // Bound 2: Since m >= 5, the grid geometrically contains a 4 x n subgrid.
  // A graph's rank number must be >= the rank number of its subgraph.
  const subgridBound = getLowerBound(4, max);

  // Return the strictest known lower bound
  return Math.max(squareBound, subgridBound);
};

const CELL = 40;     // px per cell
const GAP = 2;       // px gap between cells
const MAX = 100;     // max grid dimension

const MatrixView: React.FC<MatrixViewProps> = ({ data, onCellClick, mode, customFormula = '' }) => {
  const { alias } = useAlias();
  const [tooltipData, setTooltipData] = React.useState<{
    x: number;
    y: number;
    m: number;
    n: number;
    rank: number;
    solver: string;
    lowerBound: number;
    metricValue: number | string | null;
  } | null>(null);

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
      
      let goodness = 0;
      if (cellData.min_rank === 1) goodness = 1.0;
      else if (cellData.min_rank <= 5) goodness = 0.8;
      else if (cellData.min_rank <= 15) goodness = 0.6;
      else if (cellData.min_rank <= 30) goodness = 0.4;
      else if (cellData.min_rank <= 100) goodness = 0.2;
      else goodness = 0.05;

      bgColor = `color-mix(in srgb, var(--tile-selected) ${Math.round(goodness * 100)}%, var(--bg-card))`;
      color = '#ffffff';

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
    background: 'color-mix(in srgb, var(--tile-primary) 85%, transparent)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    color: '#ffffff',
    fontWeight: 800,
    fontSize: `${CELL * 0.3}px`,
    textAlign: 'center',
    verticalAlign: 'middle',
    borderRadius: '8px',
    boxSizing: 'border-box',
    padding: 0,
    border: '1px solid rgba(255,255,255,0.05)',
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
            >
              <div style={{ position: 'absolute', top: 2, right: 4, fontSize: '10px', color: 'rgba(255,255,255,0.7)', lineHeight: 1 }}>m</div>
              <div style={{ position: 'absolute', bottom: 2, left: 4, fontSize: '10px', color: 'rgba(255,255,255,0.7)', lineHeight: 1 }}>n</div>
              <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <line x1="0" y1="0" x2="100%" y2="100%" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
              </svg>
            </th>
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
                    onMouseEnter={(e) => {
                      if (cellRender && cellData) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltipData({
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                          m, n,
                          rank: cellRender.minRank,
                          solver: cellRender.solver,
                          lowerBound: cellRender.lowerBound,
                          metricValue: cellRender.metricValue
                        });
                      }
                    }}
                    onMouseLeave={() => setTooltipData(null)}
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
                      transition: 'background 0.2s, opacity 0.2s, transform 0.1s',
                      boxShadow: cellRender ? 'inset 0 1px 1px rgba(255,255,255,0.1), 0 2px 4px rgba(0,0,0,0.1)' : 'none',
                    }}
                    className={cellRender ? 'hover-row' : ''}
                  >
                    {cellRender ? cellRender.content : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Custom Tooltip */}
      {tooltipData && (
        <div
          style={{
            position: 'fixed',
            left: tooltipData.x,
            top: tooltipData.y - 10,
            transform: 'translate(-50%, -100%)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '12px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.6)',
            zIndex: 9999,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            fontSize: '12px',
            color: 'var(--text-main)',
            minWidth: '160px',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '4px', marginBottom: '4px' }}>
            Grid: {tooltipData.m} × {tooltipData.n}
          </div>
          <div><span style={{ color: 'var(--text-muted)' }}>Community Rank:</span> <strong style={{ color: 'var(--text-main)' }}>{tooltipData.rank}</strong></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Lower Bound:</span> <strong style={{ color: 'var(--text-main)' }}>{tooltipData.lowerBound}</strong></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Top Solver:</span> <strong style={{ color: 'var(--text-main)' }}>{tooltipData.solver}</strong></div>
          {tooltipData.metricValue !== null && (
            <div><span style={{ color: 'var(--text-muted)' }}>Metric:</span> <strong style={{ color: 'var(--text-main)' }}>{typeof tooltipData.metricValue === 'number' ? tooltipData.metricValue.toFixed(3) : tooltipData.metricValue}</strong></div>
          )}
          
          <div style={{
            position: 'absolute',
            bottom: '-6px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid var(--border-subtle)'
          }} />
          <div style={{
            position: 'absolute',
            bottom: '-5px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid var(--bg-card)'
          }} />
        </div>
      )}
    </div>
  );
};

export default MatrixView;
