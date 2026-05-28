import React from 'react';

export const PathExample: React.FC = () => {
    const nodes = [1, 2, 1, 3, 1];
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '24px 0', padding: '16px', background: 'var(--bg-inset)', borderRadius: '8px' }}>
            {nodes.map((rank, i) => (
                <React.Fragment key={i}>
                    <div style={{
                        width: '40px', height: '40px', borderRadius: '50%',
                        background: rank === 3 ? 'var(--tile-selected, #8b5cf6)' : 'var(--tile-primary, #334155)',
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 'bold', border: '2px solid var(--border-subtle)'
                    }}>
                        {rank}
                    </div>
                    {i < nodes.length - 1 && <div style={{ height: '4px', width: '30px', background: 'var(--border-subtle)' }} />}
                </React.Fragment>
            ))}
        </div>
    );
};