import { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";

import { submitScore } from "../../api/api";
import type { Palette } from "../../state/settingsSlice";
import type { CutHistoryAction } from "../../state/gameSlice";

type VictoryModalProps = {
  rank: number;
  gridSize: { m: number; n: number };
  cutsApplied: CutHistoryAction[];
  oldTopScore: { rank: number; solver_name: string } | null;
  palette: Palette;
  alias: string;
  onPlayAgain: () => void;
  onReviewBoard: () => void;
};

const DEFAULT_SOLVER = "Anonymous";

const VictoryModal = ({
  rank,
  gridSize,
  cutsApplied,
  oldTopScore,
  palette,
  alias,
  onPlayAgain,
  onReviewBoard,
}: VictoryModalProps) => {
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const submit = async () => {
      setStatus("submitting");
      setMessage(null);
      try {
        const latestAlias = localStorage.getItem("howl_alias") || alias;
        const submitAlias = latestAlias.trim() || DEFAULT_SOLVER;

        await submitScore(
          gridSize.m,
          gridSize.n,
          rank,
          submitAlias,
          cutsApplied,
        );
        if (!mounted) return;

        let resultMsg = "";
        if (!oldTopScore) {
          resultMsg = `First to solve this grid! Saved as ${submitAlias}`;
        } else if (rank < oldTopScore.rank) {
          if (oldTopScore.solver_name === submitAlias) {
            resultMsg = `You beat your own record! Saved as ${submitAlias}`;
          } else {
            resultMsg = `You beat ${oldTopScore.solver_name}'s record! Saved as ${submitAlias}`;
          }
        } else if (rank === oldTopScore.rank) {
          if (oldTopScore.solver_name === submitAlias) {
            resultMsg = `You matched your own record!`;
          } else {
            resultMsg = `You tied with ${oldTopScore.solver_name}'s record!`;
          }
        } else {
          resultMsg = `Score submitted! (The record is ${oldTopScore.rank})`;
        }

        setMessage(resultMsg);
        setStatus("success");
      } catch (error) {
        if (!mounted) return;
        setStatus("error");
        setMessage(
          error instanceof Error ? error.message : "Failed to submit score.",
        );
      }
    };

    submit();

    return () => {
      mounted = false;
    };
  }, [gridSize.m, gridSize.n, rank, alias, cutsApplied]);

  const isNewRecord = !oldTopScore || rank < oldTopScore.rank;
  const rankColorHex = '#' + palette.highlight.toString(16).padStart(6, '0');

  // Capture palette hex codes once to avoid re-running on every render
  const hexColors = useMemo(() => [
    '#' + palette.tileA.toString(16).padStart(6, '0'),
    '#' + palette.tileB.toString(16).padStart(6, '0'),
    '#' + palette.highlight.toString(16).padStart(6, '0'),
    '#' + palette.select.toString(16).padStart(6, '0'),
  ], [palette.tileA, palette.tileB, palette.highlight, palette.select]);

  useEffect(() => {
    // ANIMATION ORCHESTRATION:
    // The final rank element finishes its spring slam animation around 1200ms.
    // The confetti fires exactly at 1300ms to emphasize the impact.
    const timer = setTimeout(() => {
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: hexColors,
        zIndex: 10000,
      });
    }, 1300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run strictly once on mount

  return (
    <div className="victory-overlay">
      <motion.div
        className="victory-modal"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        {/* ANIMATION ORCHESTRATION: Title appears after a 400ms beat */}
        <motion.h2
          className="victory-title"
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, type: "spring", stiffness: 300 }}
          style={{ textAlign: 'center', fontSize: '2rem', marginBottom: '8px' }}
        >
          {isNewRecord ? "🎉 New Record! 🎉" : "🎉 Victory! 🎉"}
        </motion.h2>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '24px 0' }}>
          <span style={{ color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.875rem', fontWeight: 600, letterSpacing: '0.05em' }}>
            Final Rank
          </span>
          {/* ANIMATION ORCHESTRATION: Final rank slams in 400ms after the title (800ms total) */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", damping: 10, stiffness: 200, delay: 0.8 }}
            style={{
              fontSize: '4.5rem',
              fontWeight: 900,
              color: rankColorHex,
              lineHeight: 1,
              textShadow: `0 0 20px ${rankColorHex}66`
            }}
          >
            {rank}
          </motion.div>
        </div>

        <div style={{ padding: '16px', background: 'var(--bg-main)', borderRadius: '12px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>Grid Size</span>
            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{gridSize.m} × {gridSize.n}</span>
          </div>

          {oldTopScore ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Current Record</span>
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                {oldTopScore.rank} <span style={{ color: 'var(--text-muted)', fontSize: '0.9em', fontWeight: 400 }}>by {oldTopScore.solver_name}</span>
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Current Record</span>
              <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>None yet!</span>
            </div>
          )}


        </div>

        {status === "submitting" ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", marginBottom: "8px" }}>
            Submitting score...
          </div>
        ) : null}

        {message ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`victory-message ${status === 'success' ? 'record' : ''}`}
            style={{
              marginTop: '4px',
              padding: '12px',
              borderRadius: '8px',
              textAlign: 'center',
              fontWeight: 600,
              background: status === 'success' ? `${rankColorHex}15` : 'var(--bg-main)',
              color: status === 'success' ? rankColorHex : 'var(--text-main)',
              border: `1px solid ${status === 'success' ? rankColorHex : 'var(--border-subtle)'}`
            }}
          >
            {message}
          </motion.div>
        ) : null}

        <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'center', gap: '12px' }}>
          <button
            className="btn secondary"
            type="button"
            onClick={onReviewBoard}
            style={{
              padding: '12px 24px',
              fontSize: '1.1rem',
              fontWeight: 600,
              borderRadius: '99px',
            }}
          >
            Review Run
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={onPlayAgain}
            style={{
              padding: '12px 36px',
              fontSize: '1.1rem',
              fontWeight: 600,
              borderRadius: '99px',
              boxShadow: `0 4px 12px -2px ${rankColorHex}55`,
              backgroundColor: rankColorHex,
              borderColor: rankColorHex,
              color: '#ffffff',
            }}
          >
            New Game
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default VictoryModal;
