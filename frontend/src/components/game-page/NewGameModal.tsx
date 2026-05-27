import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDispatch, useSelector } from "react-redux";
import { initializeGame } from "../../state/gameSlice";

interface NewGameModalProps {
  isOpen: boolean;
  onClose: (started?: boolean) => void;
  forceGame?: boolean;
}

const NewGameModal: React.FC<NewGameModalProps> = ({
  isOpen,
  onClose,
  forceGame = false,
}) => {
  const dispatch = useDispatch();
  const { gridSize } = useSelector((state: any) => state.game);
  const [m, setM] = useState<string | number>(5);
  const [n, setN] = useState<string | number>(5);

  React.useEffect(() => {
    if (isOpen) {
      setM(gridSize?.m > 0 ? gridSize.m : 5);
      setN(gridSize?.n > 0 ? gridSize.n : 5);
    }
  }, [isOpen, gridSize]);

  const handleStart = () => {
    let finalM = typeof m === 'string' ? parseInt(m, 10) : m;
    let finalN = typeof n === 'string' ? parseInt(n, 10) : n;

    if (isNaN(finalM) || finalM <= 0) finalM = 1;
    if (isNaN(finalN) || finalN <= 0) finalN = 1;

    if (finalM > 100) finalM = 100;
    if (finalN > 100) finalN = 100;

    dispatch(initializeGame({ m: finalM, n: finalN }));
    onClose(true);
  };

  const parsedM = typeof m === 'string' ? parseInt(m, 10) || 0 : m;
  const parsedN = typeof n === 'string' ? parseInt(n, 10) || 0 : n;
  const isInvalid = parsedM > 100 || parsedN > 100;

  const adjustM = (delta: number) => {
    let val = typeof m === 'string' ? parseInt(m, 10) || 1 : m;
    val += delta;
    if (val < 1) val = 1;
    if (val > 100) val = 100;
    setM(val);
  };

  const adjustN = (delta: number) => {
    let val = typeof n === 'string' ? parseInt(n, 10) || 1 : n;
    val += delta;
    if (val < 1) val = 1;
    if (val > 100) val = 100;
    setN(val);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="modal-overlay">
          <motion.div
            className="modal-content"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <h2 className="title" style={{ fontSize: "1.4rem", margin: 0 }}>
              New Game Setup
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              Configure your checkerboard grid.
            </p>

            <div className="grid-config" style={{ marginTop: "12px" }}>
              <div className="grid-inputs">
                <div className="grid-label">
                  Columns (m)
                  <div className="stepper-wrapper">
                    <button className="stepper-btn" onClick={() => adjustM(-1)}>-</button>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={m}
                      onChange={(e) => setM(e.target.value)}
                      className={`grid-input modal-input ${parsedM > 100 ? 'invalid' : ''}`}
                      style={parsedM > 100 ? { borderColor: 'var(--rank-0)', color: 'var(--rank-0)' } : {}}
                    />
                    <button className="stepper-btn" onClick={() => adjustM(1)}>+</button>
                  </div>
                </div>
                <div className="grid-label">
                  Rows (n)
                  <div className="stepper-wrapper">
                    <button className="stepper-btn" onClick={() => adjustN(-1)}>-</button>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={n}
                      onChange={(e) => setN(e.target.value)}
                      className={`grid-input modal-input ${parsedN > 100 ? 'invalid' : ''}`}
                      style={parsedN > 100 ? { borderColor: 'var(--rank-0)', color: 'var(--rank-0)' } : {}}
                    />
                    <button className="stepper-btn" onClick={() => adjustN(1)}>+</button>
                  </div>
                </div>
              </div>
              {isInvalid && (
                <div style={{ color: 'var(--rank-0)', fontSize: '0.85rem', marginTop: '8px', textAlign: 'center', fontWeight: 600 }}>
                  Max grid size is 100x100!
                </div>
              )}
            </div>

            <div className="modal-actions">
              {!forceGame && (
                <button
                  className="btn secondary"
                  style={{ flex: 1 }}
                  onClick={() => onClose()}
                >
                  Cancel
                </button>
              )}
              <button
                className="btn primary"
                style={{ flex: 1 }}
                onClick={handleStart}
                disabled={isInvalid}
              >
                Start Game
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default NewGameModal;
