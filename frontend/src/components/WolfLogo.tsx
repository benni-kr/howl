import React from 'react';
import wolfLogoUrl from '../assets/wolf-logo.svg';

interface WolfLogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const WolfLogo: React.FC<WolfLogoProps> = ({ size = 32, className = '', style }) => {
  return (
    <span
      className={`wolf-logo ${className}`}
      style={{
        display: 'inline-block',
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: 'currentColor',
        WebkitMaskImage: `url(${wolfLogoUrl})`,
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskImage: `url(${wolfLogoUrl})`,
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        ...style,
      }}
    />
  );
};
