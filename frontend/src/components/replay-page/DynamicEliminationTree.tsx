import React from 'react';
import { EliminationNode } from '../../hooks/useReplayEngine';

const TreeNode: React.FC<{ node: EliminationNode }> = ({ node }) => {
  // 1. Separate branches with history from empty base-case leaves
  const activeChildren = node.children ? node.children.filter(child => child.action || (child.children && child.children.length > 0)) : [];
  const emptyLeavesCount = node.children ? node.children.length - activeChildren.length : 0;

  // 2. Determine the total visual columns we need to draw
  const totalVisualBranches = activeChildren.length + (emptyLeavesCount > 0 ? 1 : 0);

  // Hardcoded fallback color so your lines never vanish again
  const lineColor = 'var(--border-strong, #475569)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

      {/* Current Node Box */}
      {!node.action ? (
        <div style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          background: 'var(--bg-inset)',
          border: `2px dashed ${lineColor}`,
          zIndex: 2,
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }} />
      ) : node.action.type === 'vaporize' ? (
        <div style={{
          padding: '4px 12px',
          borderRadius: '20px',
          background: '#1e1b4b', // Deep purple
          color: '#fbbf24', // Gold text
          fontSize: '0.9rem',
          fontWeight: 'bold',
          zIndex: 2,
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          whiteSpace: 'nowrap',
          width: 'max-content'
        }}>
          🪄 {node.action.optimal_rank}
        </div>
      ) : node.action.type === 'ignore' ? (
        <div style={{
          padding: '4px 12px',
          borderRadius: '20px',
          background: '#334155', // Slate
          color: 'var(--text-main)',
          border: `2px solid ${lineColor}`,
          fontSize: '0.9rem',
          fontWeight: 'bold',
          zIndex: 2,
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          whiteSpace: 'nowrap',
          width: 'max-content'
        }}>
          🪞 Duplicate
        </div>
      ) : (
        <div style={{
          padding: '4px 12px',
          borderRadius: '20px',
          background: 'var(--bg-card)',
          border: `2px solid ${lineColor}`,
          color: 'var(--text-main)',
          fontSize: '0.9rem',
          fontWeight: 'bold',
          zIndex: 2,
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          whiteSpace: 'nowrap',
          width: 'max-content'
        }}>
          ✂ {node.action.vertices.length}
        </div>
      )}

      {/* Children branches */}
      {totalVisualBranches > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
          {/* Stem dropping down from parent */}
          <div style={{ width: '2px', height: '20px', background: lineColor }} />

          <div style={{ display: 'flex', width: '100%', justifyContent: 'center', position: 'relative' }}>

            {/* Map the Active Branches */}
            {activeChildren.map((child, index) => (
              <div key={child.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative', padding: '0 8px' }}>

                {/* Horizontal bridging line */}
                {totalVisualBranches > 1 && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: index === 0 ? '50%' : 0,
                    // If this is the last active child AND there are no empty leaves, cut the line at 50%
                    right: (index === activeChildren.length - 1 && emptyLeavesCount === 0) ? '50%' : 0,
                    height: '2px',
                    background: lineColor
                  }} />
                )}

                {/* Stem dropping down to child */}
                <div style={{ width: '2px', height: '20px', background: lineColor }} />

                {/* Recursive call */}
                <TreeNode node={child} />
              </div>
            ))}

            {/* Map ONE Collapsed Base-Case Node (if any exist) */}
            {emptyLeavesCount > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative', padding: '0 8px' }}>

                {/* Horizontal bridging line for the collapsed node */}
                {totalVisualBranches > 1 && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: activeChildren.length === 0 ? '50%' : 0,
                    right: '50%', // It is always the right-most node, so line ends at 50%
                    height: '2px',
                    background: lineColor
                  }} />
                )}

                <div style={{ width: '2px', height: '20px', background: lineColor }} />

                {/* The new Collapsed Base Case Pill */}
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'var(--bg-inset)',
                  border: `2px dashed ${lineColor}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}>
                  x{emptyLeavesCount}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
};

export const DynamicEliminationTree: React.FC<{ rootNode: EliminationNode }> = ({ rootNode }) => {
  return (
    <div style={{ display: 'inline-flex', justifyContent: 'center', minWidth: '100%', padding: '24px 32px 64px 32px' }}>
      <TreeNode node={rootNode} />
    </div>
  );
};