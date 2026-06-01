import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { motion } from 'framer-motion';
import { RootState } from '../../state/store';
import { markAsSeen, requestShowTooltip, clearActiveTooltip } from '../../state/userPreferencesSlice';

interface OnboardingTooltipProps {
  tutorialKey: string;
  content: React.ReactNode;
  children?: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'fixed-canvas' | 'canvas-left' | 'canvas-right';
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
    if (!hasSeen && activeTooltip === null) {
      dispatch(requestShowTooltip(tutorialKey));
    }
    
    // Cleanup if this tooltip unmounts while it is active
    return () => {
      if (activeTooltip === tutorialKey) {
        dispatch(clearActiveTooltip(tutorialKey));
      }
    };
  }, [hasSeen, activeTooltip, tutorialKey, dispatch]);

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
        top: '60px',
        right: '20px',
        zIndex: 999,
        width: 'max-content',
        maxWidth: '220px'
      };
    }

    if (position === 'canvas-left') {
      return {
        position: 'absolute',
        top: '60px',
        left: '20px',
        zIndex: 999,
        width: 'max-content',
        maxWidth: '220px'
      };
    }

    if (position === 'canvas-right') {
      return {
        position: 'absolute',
        top: '60px',
        right: '20px',
        zIndex: 999,
        width: 'max-content',
        maxWidth: '220px'
      };
    }

    // Default positioning for wrapped elements
    const base: React.CSSProperties = {
      position: 'absolute',
      zIndex: 999,
      width: 'max-content',
      maxWidth: '220px',
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
    <div style={
      position === 'fixed-canvas' || position === 'canvas-left' || position === 'canvas-right'
        ? { position: 'absolute', top: 0, left: 0, width: '100%', height: 0, pointerEvents: 'none', zIndex: 999 } 
        : { position: 'relative', display: 'inline-block' }
    }>
      
      {children}
      
      <motion.div
        initial={{ opacity: 0, y: position === 'top' || position === 'fixed-canvas' ? 10 : -10 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          ...getPositionStyles(),
          background: 'var(--bg-card)',
          border: '2px solid var(--tile-primary)',
          borderRadius: '12px',
          padding: '16px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 0 15px color-mix(in srgb, var(--tile-primary) 40%, transparent)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxSizing: 'border-box',
          pointerEvents: 'auto',
          zIndex: 1000
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
            borderRadius: '6px',
            padding: '8px 14px',
            cursor: 'pointer',
            fontWeight: 'bold',
            alignSelf: 'flex-end',
            fontSize: '13px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
          }}
        >
          Got it!
        </button>
      </motion.div>
    </div>
  );
};
