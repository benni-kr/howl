import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { motion } from 'framer-motion';
import { RootState } from '../../state/store';
import { markAsSeen, requestShowTooltip } from '../../state/userPreferencesSlice';

interface OnboardingTooltipProps {
  tutorialKey: string;
  content: React.ReactNode;
  children?: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'fixed-canvas';
}

export const OnboardingTooltip: React.FC<OnboardingTooltipProps> = ({
  tutorialKey,
  content,
  children,
  position = 'top',
}) => {
  const dispatch = useDispatch();
  const { tutorialsSeen, activeTooltip } = useSelector((state: RootState) => state.userPreferences);
  const hasSeen = tutorialsSeen[tutorialKey];
  const isActive = activeTooltip === tutorialKey;

  useEffect(() => {
    if (!hasSeen) {
      dispatch(requestShowTooltip(tutorialKey));
    }
  }, [hasSeen, tutorialKey, dispatch]);

  const handleDismiss = () => {
    dispatch(markAsSeen(tutorialKey));
  };

  if (hasSeen || !isActive) {
    return <>{children}</>;
  }

  const getPositionStyles = (): React.CSSProperties => {
    if (position === 'fixed-canvas') {
      return {
        position: 'absolute',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
      };
    }
    
    // Default positioning for wrapped elements
    const base: React.CSSProperties = {
      position: 'absolute',
      zIndex: 50,
      minWidth: '220px',
    };

    switch (position) {
      case 'top':
        return { ...base, bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '12px' };
      case 'bottom':
        return { ...base, top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '12px' };
      case 'left':
        return { ...base, right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: '12px' };
      case 'right':
        return { ...base, left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: '12px' };
      default:
        return base;
    }
  };

  return (
    <div style={{ position: position === 'fixed-canvas' ? 'static' : 'relative', display: 'inline-block' }}>
      {/* Pulsing glow if wrapping an element */}
      {position !== 'fixed-canvas' && (
        <motion.div
          animate={{ boxShadow: ['0 0 0px var(--tile-selected)', '0 0 15px var(--tile-selected)', '0 0 0px var(--tile-selected)'] }}
          transition={{ repeat: Infinity, duration: 2 }}
          style={{ position: 'absolute', inset: -4, borderRadius: '8px', pointerEvents: 'none' }}
        />
      )}
      
      {children}
      
      <motion.div
        initial={{ opacity: 0, y: position === 'top' || position === 'fixed-canvas' ? 10 : -10 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          ...getPositionStyles(),
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          padding: '16px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ color: 'var(--text-main)', fontSize: '14px', lineHeight: '1.5' }}>
          {content}
        </div>
        <button
          onClick={handleDismiss}
          style={{
            background: 'var(--tile-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            padding: '6px 12px',
            cursor: 'pointer',
            fontWeight: 'bold',
            alignSelf: 'flex-end',
            fontSize: '13px'
          }}
        >
          Got it!
        </button>
      </motion.div>
    </div>
  );
};
