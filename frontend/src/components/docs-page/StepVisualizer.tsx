import React, { useState } from 'react';

export const StepVisualizer: React.FC = () => {
    const [step, setStep] = useState(0);

    const nextStep = () => setStep(s => Math.min(4, s + 1));
    const prevStep = () => setStep(s => Math.max(0, s - 1));

    const getNodeStyle = (index: number) => {
        const isMiddleCol = index === 1 || index === 4 || index === 7;
        const isLeftMiddle = index === 3;
        const isRightCol = index === 2 || index === 5 || index === 8;

        let bg = 'var(--tile-primary, #334155)';
        let opacity = 1;
        let border = 'none';

        if (step >= 1 && isMiddleCol) {
            bg = 'var(--tile-selected, #ef4444)';
            if (step > 1) opacity = 0.1;
        }
        if (step >= 2 && isLeftMiddle) {
            bg = 'var(--tile-selected, #ef4444)';
            if (step > 2) opacity = 0.1;
        }
        if (step >= 3 && isRightCol) {
            bg = 'var(--tile-selected)';
            if (step > 3) opacity = 0.1;
        }

        return {
            width: '40px', height: '40px', borderRadius: '6px',
            background: bg, opacity, border,
            transition: 'all 0.3s ease',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold'
        };
    };

    return (
        <div style={{ background: 'var(--bg-inset)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-subtle)', margin: '32px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h3 style={{ margin: 0 }}>Game Engine Tracker: Step {step} of 4</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={prevStep} disabled={step === 0} style={{ padding: '6px 12px', borderRadius: '4px', cursor: step === 0 ? 'not-allowed' : 'pointer', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }}>Prev</button>
                    <button onClick={nextStep} disabled={step === 4} style={{ padding: '6px 12px', borderRadius: '4px', cursor: step === 4 ? 'not-allowed' : 'pointer', background: 'var(--tile-selected)', opacity: step === 4 ? 0.4 : 1, color: '#fff', border: 'none' }}>Next</button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '16px', color: 'var(--text-muted)' }}>The Grid (Player View)</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 40px)', gap: '8px', justifyContent: 'center' }}>
                        {[...Array(9)].map((_, i) => (
                            <div key={i} style={getNodeStyle(i)}>
                                {step >= 3 && (i === 2 || i === 5 || i === 8) ? '🪄' : ''}
                            </div>
                        ))}
                    </div>
                    <div style={{ marginTop: '24px', fontSize: '0.9rem', color: 'var(--text-muted)', minHeight: '60px' }}>
                        {step === 0 && "We start with a fresh 3x3 grid. The rank is currently unknown."}
                        {step === 1 && "The player cuts the middle column (3 blocks). The board splits into two disconnected 1x3 pieces."}
                        {step === 2 && "The player cuts the middle block of the left piece (1 block). It splits into two 1x1 base-case blocks."}
                        {step === 3 && "The player uses the Magic Wand to vaporize the right 1x3 piece. The community dictionary knows the current best rank for this shape is 2 (which is also optimal)."}
                        {step === 4 && "The board is clear! The backend now calculates the score bottom-up using the math tree."}
                    </div>
                </div>

                <div style={{ flex: 1, minWidth: '250px', borderLeft: '2px dashed var(--border-subtle)', paddingLeft: '32px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '16px', color: 'var(--text-muted)' }}>The Math Tree (Backend View)</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '1rem', lineHeight: '2' }}>
                        {step === 0 && <div style={{ color: 'var(--tile-selected)' }}>Root Rank: [ ? ]</div>}
                        {step === 1 && (
                            <>
                                <div style={{ color: 'var(--text-main)' }}>Root Rank: 3 + max(Left, Right)</div>
                                <div style={{ color: 'var(--text-muted)', marginLeft: '20px' }}>├─ Left (1x3): [ ? ]</div>
                                <div style={{ color: 'var(--text-muted)', marginLeft: '20px' }}>└─ Right (1x3): [ ? ]</div>
                            </>
                        )}
                        {step === 2 && (
                            <>
                                <div style={{ color: 'var(--text-main)' }}>Root Rank: 3 + max(Left, Right)</div>
                                <div style={{ color: 'var(--tile-primary)', marginLeft: '20px' }}>├─ Left: 1 + max(1, 1) = 2</div>
                                <div style={{ color: 'var(--text-muted)', marginLeft: '20px' }}>└─ Right (1x3): [ ? ]</div>
                            </>
                        )}
                        {step === 3 && (
                            <>
                                <div style={{ color: 'var(--text-main)' }}>Root Rank: 3 + max(Left, Right)</div>
                                <div style={{ color: 'var(--tile-primary)', marginLeft: '20px' }}>├─ Left: 1 + max(1, 1) = 2</div>
                                <div style={{ color: 'var(--tile-primary)', marginLeft: '20px' }}>└─ Right: Vaporized = 2</div>
                            </>
                        )}
                        {step === 4 && (
                            <>
                                <div style={{ color: 'var(--text-main)' }}>
                                    <span style={{ color: 'var(--tile-primary)' }}>Root Rank: 3 + max(2, 2) = </span><span style={{ color: 'var(--tile-selected)' }}>5</span>
                                </div>
                                <div style={{ color: 'var(--text-muted)', marginLeft: '20px' }}>├─ Left Branch Rank: 2</div>
                                <div style={{ color: 'var(--text-muted)', marginLeft: '20px' }}>└─ Right Branch Rank: 2</div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};