import React from 'react';
import { EliminationNode } from '../../hooks/useReplayEngine';

const TreeNode: React.FC<{ node: EliminationNode }> = ({ node }) => {
  const hasChildren = node.children && node.children.length > 0;

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
      {hasChildren && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
          {/* Stem dropping down from parent */}
          <div style={{ width: '2px', height: '20px', background: lineColor }} />

          <div style={{ display: 'flex', width: '100%', justifyContent: 'center', position: 'relative' }}>
            {node.children.map((child, index) => (
              <div key={child.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative', padding: '0 8px' }}>

                {/* Horizontal bridging line (only if there are siblings) */}
                {node.children.length > 1 && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: index === 0 ? '50%' : 0,
                    right: index === node.children.length - 1 ? '50%' : 0,
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