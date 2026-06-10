import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../state/store';
import { setShowGridIndices, setShowCoordinateSystem, setShowGridLines } from '../../state/settingsSlice';

export const DisplaySettings: React.FC = () => {
  const dispatch = useDispatch();
  const settings = useSelector((state: RootState) => state.settings);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      background: 'var(--bg-card)',
      padding: '12px 16px',
      borderRadius: '12px',
      border: '1px solid var(--border-subtle)',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
      marginTop: '4px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', cursor: 'pointer' }} onClick={() => dispatch(setShowGridIndices(!settings.showGridIndices))}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Coordinates</span>
        <div style={{
          width: '36px', height: '20px',
          background: settings.showGridIndices ? 'var(--tile-selected)' : 'var(--bg-inset)',
          borderRadius: '10px', position: 'relative', transition: 'background 0.2s', border: '1px solid var(--border-subtle)'
        }}>
          <div style={{
            width: '16px', height: '16px', background: '#fff', borderRadius: '50%',
            position: 'absolute', top: '1px', left: settings.showGridIndices ? '17px' : '1px',
            transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
          }} />
        </div>
      </div>
      
      <div style={{ height: '1px', background: 'var(--border-subtle)', width: '100%', opacity: 0.6 }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', cursor: 'pointer' }} onClick={() => dispatch(setShowCoordinateSystem(!settings.showCoordinateSystem))}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Coordinate System</span>
        <div style={{
          width: '36px', height: '20px',
          background: settings.showCoordinateSystem ? 'var(--tile-selected)' : 'var(--bg-inset)',
          borderRadius: '10px', position: 'relative', transition: 'background 0.2s', border: '1px solid var(--border-subtle)'
        }}>
          <div style={{
            width: '16px', height: '16px', background: '#fff', borderRadius: '50%',
            position: 'absolute', top: '1px', left: settings.showCoordinateSystem ? '17px' : '1px',
            transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
          }} />
        </div>
      </div>

      <div style={{ height: '1px', background: 'var(--border-subtle)', width: '100%', opacity: 0.6 }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', cursor: 'pointer' }} onClick={() => dispatch(setShowGridLines(!settings.showGridLines))}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Grid Lines</span>
        <div style={{
          width: '36px', height: '20px',
          background: settings.showGridLines ? 'var(--tile-selected)' : 'var(--bg-inset)',
          borderRadius: '10px', position: 'relative', transition: 'background 0.2s', border: '1px solid var(--border-subtle)'
        }}>
          <div style={{
            width: '16px', height: '16px', background: '#fff', borderRadius: '50%',
            position: 'absolute', top: '1px', left: settings.showGridLines ? '17px' : '1px',
            transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
          }} />
        </div>
      </div>
    </div>
  );
};
