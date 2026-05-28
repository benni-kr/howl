import React from "react";
import { Link, useLocation } from "react-router-dom";
import { WolfLogo } from "./WolfLogo";

type TopNavBarProps = {
  alias: string | null;
  onEditAlias: () => void;
};

const TopNavBar: React.FC<TopNavBarProps> = ({
  alias,
  onEditAlias,
}) => {
  const location = useLocation();
  const isGameRoute = location.pathname === "/";

  return (
    <div className="top-nav-bar">
      
        <div className={`top-nav-left ${isGameRoute ? "desktop-hidden" : ""}`} style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <Link to="/" className="logo-text" style={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none', color: 'var(--logo-color)' }}>
            <WolfLogo size={36} />
            <span style={{ fontFamily: '"Permanent Marker", cursive', fontSize: '2.4rem', letterSpacing: '0.12rem', textTransform: 'uppercase', lineHeight: 1 }}>HOWL</span>
          </Link>
          
          {!isGameRoute && (
            <div style={{
              fontSize: '1.2rem',
              fontWeight: 700,
              color: 'var(--text-main)',
              borderLeft: '2px solid var(--border-subtle)',
              paddingLeft: '24px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              {location.pathname.startsWith('/leaderboard') && "Leaderboards"}
              {location.pathname.startsWith('/settings') && "Settings"}
              {location.pathname.startsWith('/docs') && "Documentation"}
            </div>
          )}
        </div>

      <div className="top-nav-right" style={{ display: 'flex', alignItems: 'center', gap: '16px', marginLeft: 'auto' }}>
        <button className="btn secondary alias-pill" onClick={onEditAlias}>
          <span className="alias-text">{alias || "Anonymous"}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>

        <Link to="/leaderboard" className="btn ghost nav-link icon-btn" title="Leaderboard" style={{ textDecoration: 'none' }}>
          🏆
        </Link>
        <Link to="/docs" className="btn ghost nav-link icon-btn" title="Docs" style={{ textDecoration: 'none' }}>
          📖
        </Link>
        <Link to="/settings" className="btn ghost nav-link icon-btn" title="Settings" style={{ textDecoration: 'none' }}>
          ⚙️
        </Link>
      </div>
    </div>
  );
};

export default TopNavBar;
