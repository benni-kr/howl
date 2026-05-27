import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MatrixCellData } from '../../api/api';
import { useAlias } from '../../hooks/useAlias';



interface MatrixViewProps {
  data: MatrixCellData[];
  onCellClick: (m: number, n: number) => void;
  mode: 'min_rank' | 'top_solver' | 'density';
}

const MatrixView: React.FC<MatrixViewProps> = ({ data, onCellClick, mode }) => {
  const { alias } = useAlias();
  const parentRef = useRef<HTMLDivElement>(null);

  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const BASE_CELL_SIZE = 48;
  const CELL_GAP = 2;
  const currentCellSize = Math.max(16, Math.min(BASE_CELL_SIZE * zoomLevel, 120));

  // Create a lookup map for fast rendering
  const dataMap = useMemo(() => {
    const map = new Map<string, MatrixCellData>();
    data.forEach(cell => {
      // Internal state uses 1-indexed for visual m/n?
      // Wait, in HOWL grids are m, n. The inputs are 1 to 100.
      map.set(`${cell.m}-${cell.n}`, cell);
    });
    return map;
  }, [data]);

  const rowVirtualizer = useVirtualizer({
    count: 101, // 0 is the axis
    getScrollElement: () => parentRef.current,
    estimateSize: () => currentCellSize + CELL_GAP,
    overscan: 5,
  });

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: 101, // 0 is the axis
    getScrollElement: () => parentRef.current,
    estimateSize: () => currentCellSize + CELL_GAP,
    overscan: 5,
  });

  // Panning logic
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!parentRef.current) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      scrollLeft: parentRef.current.scrollLeft,
      scrollTop: parentRef.current.scrollTop,
    });
    document.body.style.userSelect = 'none'; // Prevent text selection while dragging
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !parentRef.current) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    parentRef.current.scrollLeft = dragStart.scrollLeft - dx;
    parentRef.current.scrollTop = dragStart.scrollTop - dy;
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Zoom logic
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!parentRef.current) return;
    e.preventDefault(); // Prevent native scroll

    // Zoom around cursor
    const rect = parentRef.current.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    const oldScrollLeft = parentRef.current.scrollLeft;
    const oldScrollTop = parentRef.current.scrollTop;
    const oldCellSize = currentCellSize;

    // Calculate new zoom
    const zoomDelta = e.deltaY * -0.001;
    let newZoom = zoomLevel + zoomDelta;
    newZoom = Math.max(0.3, Math.min(newZoom, 3)); // Clamp zoom
    setZoomLevel(newZoom);

    // Adjust scroll to keep cursor anchored (will be applied in next effect)
    requestAnimationFrame(() => {
      if (!parentRef.current) return;
      const newCellSize = Math.max(16, Math.min(BASE_CELL_SIZE * newZoom, 120));
      const scale = newCellSize / oldCellSize;

      parentRef.current.scrollLeft = (oldScrollLeft + cursorX) * scale - cursorX;
      parentRef.current.scrollTop = (oldScrollTop + cursorY) * scale - cursorY;
    });
  }, [zoomLevel, currentCellSize]);

  useEffect(() => {
    const el = parentRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

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
      // Heatmap logic
      bgColor = 'var(--tile-dark)';
      opacity = Math.max(0.2, Math.min(1, density * 2)); // Adjust multiplier as needed
      color = '#fff';
    }

    return { content, bgColor, color, border, opacity };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Virtualized Container */}
      <div
        ref={parentRef}
        onMouseDown={handleMouseDown}
        style={{
          flex: 1,
          overflow: 'auto',
          background: 'var(--bg-inset)',
          cursor: isDragging ? 'grabbing' : 'grab',
          // hide scrollbars
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
        className="hide-scrollbars" // Ensure we have css to hide webkit scrollbars
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: `${columnVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => (
            <React.Fragment key={virtualRow.key}>
              {columnVirtualizer.getVirtualItems().map((virtualColumn) => {
                const m = virtualColumn.index; // 0 to 100
                const n = virtualRow.index; // 0 to 100

                // The 0,0 cell is empty
                if (m === 0 && n === 0) return null;

                const isAxis = m === 0 || n === 0;

                // Only render where m >= n, unless it's an axis
                if (!isAxis && m < n) return null;

                const cellRender = isAxis ? null : getCellContent(m, n);

                return (
                  <div
                    key={`${virtualRow.index}-${virtualColumn.index}`}
                    onClick={() => {
                      if (cellRender) onCellClick(m, n);
                    }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: `${currentCellSize}px`,
                      height: `${currentCellSize}px`,
                      transform: `translateX(${virtualColumn.start}px) translateY(${virtualRow.start}px)`,
                      background: isAxis ? 'var(--bg-main)' : (cellRender ? cellRender.bgColor : 'rgba(0,0,0,0.05)'),
                      border: isAxis ? 'none' : (cellRender ? cellRender.border : '1px dashed var(--border-subtle)'),
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: `${currentCellSize * 0.3}px`,
                      fontWeight: isAxis ? 800 : 600,
                      color: isAxis ? 'var(--text-main)' : (cellRender ? cellRender.color : 'transparent'),
                      opacity: isAxis ? 1 : (cellRender ? cellRender.opacity : 0.5),
                      boxSizing: 'border-box',
                      cursor: (cellRender && !isAxis) ? 'pointer' : 'default',
                      transition: 'background 0.2s, color 0.2s, opacity 0.2s',
                      zIndex: isAxis ? 10 : 1, // Keep axis slightly above
                    }}
                  >
                    {isAxis ? (m === 0 ? n : m) : (cellRender && currentCellSize > 20 ? cellRender.content : null)}

                    {/* Tooltip hint on hover (simple native title) */}
                    {cellRender && !isAxis && (
                      <div title={`Grid: ${m}x${n}\nRank: ${dataMap.get(m + '-' + n)?.min_rank}\nSolver: ${dataMap.get(m + '-' + n)?.solver_name}`} style={{ position: 'absolute', width: '100%', height: '100%' }} />
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
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
