import React from "react";

type RankPanelProps = {
  gridSize: { m: number; n: number } | null;
  currentRank: number;
  maxRank: number;
  rankColorHex: string;
};

export const RankPanel: React.FC<RankPanelProps> = ({ gridSize, currentRank, maxRank, rankColorHex }) => {
  if (!gridSize || gridSize.m <= 0) return null;

  return (
    <div
      className="rank-panel"
      style={{
        display: "flex",
        gap: "16px",
        background: "var(--bg-card)",
        padding: "8px 24px",
        borderRadius: "16px",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
        alignItems: "center",
        minWidth: "280px",
        marginBottom: "24px",
        zIndex: 10
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
        <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", textAlign: "center" }}>
          Current Rank
        </span>
        <span style={{ fontSize: "24px", fontWeight: 800, color: rankColorHex, lineHeight: 1 }}>
          {currentRank}
        </span>
      </div>
      <div style={{ width: "1px", height: "32px", background: "var(--border-subtle)" }}></div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
        <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", textAlign: "center" }}>
          Max Rank
        </span>
        <span style={{ fontSize: "24px", fontWeight: 800, color: "var(--text-main)", lineHeight: 1 }}>
          {maxRank}
        </span>
      </div>
    </div>
  );
};
