import React from "react";
import "./EmptyState.css";

interface EmptyStateProps {
  onReport: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onReport }) => {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
      </div>
      <h2>No Known Issues!</h2>
      <p>Everything seems to be running smoothly. If you spot a bug, feel free to report it.</p>
      <button className="btn primary empty-state-btn" onClick={onReport}>
        Report an Issue
      </button>
    </div>
  );
};
