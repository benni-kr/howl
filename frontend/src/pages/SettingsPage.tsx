import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setMode, setColorTheme, THEMES, SettingsState } from "../state/settingsSlice";
import { resetTutorials } from "../state/userPreferencesSlice";

const SettingsPage: React.FC = () => {
  const dispatch = useDispatch();
  const [resetSuccess, setResetSuccess] = useState(false);
  const { mode, colorId } = useSelector(
    (state: { settings: SettingsState }) => state.settings
  );

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
      {/* Title removed, now in TopNavBar */}
      <div className="settings-section">
        <h3 className="section-title" style={{ marginBottom: "12px" }}>Appearance</h3>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            className={`btn ${mode === "light" ? "primary" : "secondary"}`}
            style={{ flex: '1 1 140px' }}
            onClick={() => dispatch(setMode("light"))}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            Light
          </button>
          <button
            className={`btn ${mode === "dark" ? "primary" : "secondary"}`}
            style={{ flex: '1 1 140px' }}
            onClick={() => dispatch(setMode("dark"))}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            Dark
          </button>
        </div>
      </div>

      <div className="settings-section" style={{ marginTop: '32px' }}>
        <h3 className="section-title" style={{ marginBottom: "12px" }}>Color Palette</h3>
        <div className="theme-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px" }}>
          {THEMES.map((theme) => {
            const palette = mode === "light" ? theme.light : theme.dark;
            const hexA = "#" + palette.tileA.toString(16).padStart(6, '0');
            const hexB = "#" + palette.tileB.toString(16).padStart(6, '0');
            
            return (
              <button
                key={theme.id}
                className={`theme-card ${colorId === theme.id ? "active" : ""}`}
                onClick={() => dispatch(setColorTheme(theme.id))}
                style={{
                  '--hover-color': hexA,
                  padding: "12px",
                  borderRadius: "12px",
                  border: colorId === theme.id ? `2px solid ${hexA}` : "2px solid var(--border-subtle)",
                  background: "var(--bg-card)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "8px"
                } as React.CSSProperties}
              >
                <div style={{ display: "flex", width: "40px", height: "40px", borderRadius: "8px", overflow: "hidden" }}>
                  <div style={{ flex: 1, background: hexA }} />
                  <div style={{ flex: 1, background: hexB }} />
                </div>
                <span style={{ fontSize: "0.9rem", color: "var(--text-main)", fontWeight: 500 }}>
                  {theme.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="settings-section" style={{ marginTop: '32px' }}>
        <h3 className="section-title" style={{ marginBottom: "12px" }}>Tutorials & Onboarding</h3>
        
        <div style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "12px",
          padding: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px"
        }}>
          <div style={{ flex: "1 1 200px" }}>
            <h4 style={{ margin: "0 0 8px 0", color: "var(--text-main)", fontSize: "1rem" }}>Reset Onboarding</h4>
            <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "0.9rem", lineHeight: "1.4" }}>
              Clear your tutorial history. Helpful hints and tooltips will appear again as you play.
            </p>
          </div>
          <button
            className={`btn ${resetSuccess ? "primary" : "secondary"}`}
            style={{ 
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: resetSuccess ? "var(--highlight)" : undefined,
              borderColor: resetSuccess ? "var(--highlight)" : undefined,
              color: resetSuccess ? "#fff" : undefined,
              transition: "all 0.3s ease"
            }}
            onClick={() => {
              dispatch(resetTutorials());
              setResetSuccess(true);
              setTimeout(() => setResetSuccess(false), 2000);
            }}
          >
            {resetSuccess ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Done!
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                Reset
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
