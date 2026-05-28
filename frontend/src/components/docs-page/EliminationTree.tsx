import React from 'react';

export const EliminationTreeExample: React.FC = () => {
    // A perfect 3x3 k-ranking corresponding to a rank of 5
    // The center column acts as the main separator (labels 5, 4, 3)
    // The left and right columns are ranked independently (1, 2, 1)
    const gridColors = [
        { label: 1, bg: '#3b82f6' }, { label: 5, bg: '#f97316' }, { label: 1, bg: '#3b82f6' },
        { label: 2, bg: '#10b981' }, { label: 4, bg: '#f59e0b' }, { label: 2, bg: '#10b981' },
        { label: 1, bg: '#3b82f6' }, { label: 3, bg: '#eab308' }, { label: 1, bg: '#3b82f6' },
    ];

    return (
        <div style={{ background: 'var(--bg-inset)', padding: '32px', borderRadius: '12px', border: '1px solid var(--border-subtle)', margin: '32px 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '32px' }}>

            {/* View 1: Colored Grid (k-ranking) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '16px', color: 'var(--text-main)' }}>1. Colored Grid (k-ranking)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 40px)', gap: '6px' }}>
                    {gridColors.map((node, i) => (
                        <div key={i} style={{
                            width: '40px', height: '40px', borderRadius: '6px', background: node.bg,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontWeight: 'bold', fontSize: '1.2rem'
                        }}>
                            {node.label}
                        </div>
                    ))}
                </div>
                <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    The final mathematical goal. No identical numbers share a path without passing through a higher number.
                </div>
            </div>

            {/* View 2: Game Tree (Separator Tree) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', borderLeft: '1px solid var(--border-subtle)', paddingLeft: '16px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '16px', color: 'var(--text-main)' }}>2. Game Tree (Cuts)</div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: 'monospace' }}>
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', padding: '8px 12px', borderRadius: '8px', textAlign: 'center', whiteSpace: 'nowrap', zIndex: 2 }}>
                        <span style={{ color: '#f97316' }}>Cut Center Col (3)</span><br />k = 3 + 2 = 5
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '-1px' }}>
                        <div style={{ width: '2px', height: '16px', background: 'var(--border-subtle)' }} />
                        <div style={{ width: '136px', borderTop: '2px solid var(--border-subtle)' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '136px' }}>
                            <div style={{ width: '2px', height: '12px', background: 'var(--border-subtle)' }} />
                            <div style={{ width: '2px', height: '12px', background: 'var(--border-subtle)' }} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '16px', marginTop: '0' }}>
                        <div style={{ width: '120px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', padding: '6px 10px', borderRadius: '8px', textAlign: 'center', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                            <span style={{ color: '#10b981' }}>Cut Left (1)</span><br />k = 1 + 1 = 2
                        </div>
                        <div style={{ width: '120px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', padding: '6px 10px', borderRadius: '8px', textAlign: 'center', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                            <span style={{ color: '#10b981' }}>Cut Right (1)</span><br />k = 1 + 1 = 2
                        </div>
                    </div>
                </div>
                <div style={{ marginTop: '24px', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    HOWL's engine. It calculates the rank bottom-up based on the size of your cuts.
                </div>
            </div>

            {/* View 3: Elimination Tree (Treedepth) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', borderLeft: '1px solid var(--border-subtle)', paddingLeft: '16px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '16px', color: 'var(--text-main)' }}>3. Elimination Tree</div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0px' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.8rem', fontWeight: 'bold', zIndex: 2 }}>5</div>
                    <div style={{ width: '2px', height: '16px', background: 'var(--border-subtle)' }} />
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.8rem', fontWeight: 'bold', zIndex: 2 }}>4</div>
                    <div style={{ width: '2px', height: '16px', background: 'var(--border-subtle)' }} />
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#eab308', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.8rem', fontWeight: 'bold', zIndex: 2 }}>3</div>

                    {/* Branch 3 -> 2s */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ width: '2px', height: '10px', background: 'var(--border-subtle)' }} />
                        <div style={{ width: '84px', borderTop: '2px solid var(--border-subtle)' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '84px' }}>
                            <div style={{ width: '2px', height: '10px', background: 'var(--border-subtle)' }} />
                            <div style={{ width: '2px', height: '10px', background: 'var(--border-subtle)' }} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '24px' }}>
                        {/* Left Subtree for 2 */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.8rem', fontWeight: 'bold', zIndex: 2 }}>2</div>
                            
                            {/* Branch 2 -> 1s */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <div style={{ width: '2px', height: '10px', background: 'var(--border-subtle)' }} />
                                <div style={{ width: '36px', borderTop: '2px solid var(--border-subtle)' }} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '36px' }}>
                                    <div style={{ width: '2px', height: '10px', background: 'var(--border-subtle)' }} />
                                    <div style={{ width: '2px', height: '10px', background: 'var(--border-subtle)' }} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.8rem', fontWeight: 'bold', zIndex: 2 }}>1</div>
                                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.8rem', fontWeight: 'bold', zIndex: 2 }}>1</div>
                            </div>
                        </div>

                        {/* Right Subtree for 2 */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.8rem', fontWeight: 'bold', zIndex: 2 }}>2</div>
                            
                            {/* Branch 2 -> 1s */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <div style={{ width: '2px', height: '10px', background: 'var(--border-subtle)' }} />
                                <div style={{ width: '36px', borderTop: '2px solid var(--border-subtle)' }} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '36px' }}>
                                    <div style={{ width: '2px', height: '10px', background: 'var(--border-subtle)' }} />
                                    <div style={{ width: '2px', height: '10px', background: 'var(--border-subtle)' }} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.8rem', fontWeight: 'bold', zIndex: 2 }}>1</div>
                                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.8rem', fontWeight: 'bold', zIndex: 2 }}>1</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    Treedepth Decomposition. Because the center cut creates a "wall" of 3 blocks, they stack vertically. The total height of the tree is the exact rank!
                </div>
            </div>

        </div>
    );
};