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
        top: '60px',
        left: '0',
        right: '0',
        margin: '0 auto',
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
      position === 'fixed-canvas' 
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
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          padding: '16px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxSizing: 'border-box',
          pointerEvents: 'auto'
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
