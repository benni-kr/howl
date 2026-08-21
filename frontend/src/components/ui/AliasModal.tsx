import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

type AliasModalProps = {
  isOpen: boolean;
  initialAlias: string | null;
  onSave: (alias: string) => void;
  onCancel?: () => void;
  forceRequired?: boolean;
};

const AliasModal: React.FC<AliasModalProps> = ({
  isOpen,
  initialAlias,
  onSave,
  onCancel,
  forceRequired = false,
}) => {
  const [inputValue, setInputValue] = useState(initialAlias || "");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setInputValue(initialAlias || "");
      setErrorMsg(null);
    }
  }, [isOpen, initialAlias]);

  if (!isOpen) return null;

  const handleSave = () => {
    const trimmed = inputValue.trim();
    if (forceRequired && !trimmed) {
      return; // Do not allow saving empty if forced
    }
    
    // Alias Blocking
    const lower = trimmed.toLowerCase();
    if (lower === "computer" || lower === "god" || lower.includes("alphawolf")) {
      setErrorMsg("This alias is reserved by the system.");
      return;
    }
    
    setErrorMsg(null);
    onSave(trimmed);
  };

  return (
    <div className="modal-overlay">
      <motion.div
        className="modal-content"
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
      >
        <h2 style={{ margin: 0, fontSize: "1.4rem" }}>
          {forceRequired ? "Welcome to HOWL" : "Edit Profile"}
        </h2>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.95rem" }}>
          {forceRequired
            ? "Please enter an alias for the global leaderboard."
            : "Update your alias for future highscores."}
        </p>

        <input
          type="text"
          className="grid-input"
          placeholder="Enter your alias..."
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (errorMsg) setErrorMsg(null);
          }}
          maxLength={15}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          style={{ padding: "12px", fontSize: "1rem", borderColor: errorMsg ? 'var(--text-danger)' : undefined }}
        />
        {errorMsg && (
          <div style={{ color: 'var(--text-danger)', fontSize: '0.85rem', marginTop: '8px' }}>
            {errorMsg}
          </div>
        )}

        <div className="modal-actions" style={{ justifyContent: "flex-end" }}>
          {!forceRequired && onCancel && (
            <button className="btn secondary" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button
            className="btn primary"
            type="button"
            onClick={handleSave}
            disabled={forceRequired && !inputValue.trim()}
          >
            {forceRequired ? "Start Playing" : "Save"}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default AliasModal;
