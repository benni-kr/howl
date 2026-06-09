import React, { useEffect, useRef } from "react";
import { CutHistoryAction } from "../../state/gameSlice";

interface ActionLogProps {
  sequence: CutHistoryAction[];
  currentStep: number;
  activeColor: string;
}

export const ActionLog: React.FC<ActionLogProps> = ({ sequence, currentStep, activeColor }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      const activeEl = container.querySelector('.active-step') as HTMLElement;
      if (activeEl && window.innerWidth > 1024) {
        // Manually scroll only the container so the main window doesn't jump
        const topOffset = activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
        container.scrollTo({
          top: topOffset,
          behavior: 'smooth'
        });
      }
    }
  }, [currentStep]);

  return (
    <div ref={containerRef} className="custom-scrollbar" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1, position: 'relative' }}>
      <div style={{ position: 'sticky', top: 0, background: 'var(--bg-main)', zIndex: 10, padding: '16px 16px 8px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
        <h3 style={{ margin: 0 }}>Action Log</h3>
      </div>
      <div style={{ padding: '8px 16px 16px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {sequence.length === 0 && <div className="muted">No actions recorded.</div>}
        {sequence.map((action, idx) => (
          <div
            key={idx}
            className={idx === currentStep ? 'active-step' : ''}
            style={{
              padding: '12px',
              borderRadius: '8px',
              background: idx < currentStep ? 'var(--bg-card)' : (idx === currentStep ? activeColor : 'var(--bg-inset)'),
              border: `1px solid ${idx === currentStep ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
              opacity: idx <= currentStep ? 1 : 0.5,
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', color: idx === currentStep ? '#000' : 'inherit' }}>
              <span>Step {idx + 1}</span>
              <span style={{
                color: idx === currentStep ? '#000' : (action.type === 'cut' ? 'var(--text-main)' : 'var(--text-highlight)'),
                fontSize: '0.8em',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                {action.type === 'ignore' ? 'duplicate' : action.type}
              </span>
            </div>
            <div style={{ fontSize: '0.9em', color: idx === currentStep ? 'rgba(0,0,0,0.7)' : 'var(--text-muted)', marginTop: '4px' }}>
              {action.type === 'vaporize'
                ? `Optimal Rank: ${action.optimal_rank}`
                : action.type === 'ignore'
                  ? `Duplicate shape trimmed`
                  : action.type === 'subgraph'
                    ? `Subgraph shape trimmed`
                    : `Vertices: ${action.vertices.length}`}
            </div>
          </div>
        ))}
        {sequence.length > 0 && currentStep === sequence.length && (
          <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-highlight)', fontWeight: 'bold' }}>
            ✓ Solved
          </div>
        )}
      </div>
    </div>
  );
};
