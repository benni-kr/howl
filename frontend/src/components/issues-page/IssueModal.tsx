import React, { useState } from "react";
import { Issue } from "../../api/api";
import "./IssueModal.css";
// Need these for the tags in view mode
import "./IssuesTable.css";

const ISSUE_TYPES = [
  "Bug",
  "Feature Request",
  "UI/UX Issue",
  "Math Logic Error",
  "Other"
];

const ISSUE_STATUSES = [
  "open",
  "in_progress",
  "closed"
];

interface IssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Issue>) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
  initialData?: Issue | null;
  submitting: boolean;
}

export const IssueModal: React.FC<IssueModalProps> = ({ isOpen, onClose, onSubmit, onDelete, initialData, submitting }) => {
  const isExisting = !!initialData;
  const [isEditing, setIsEditing] = useState(!isExisting);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [type, setType] = useState(ISSUE_TYPES[0]);
  const [description, setDescription] = useState("");
  const [runs, setRuns] = useState("");
  const [status, setStatus] = useState(ISSUE_STATUSES[0]);

  React.useLayoutEffect(() => {
    if (isOpen) {
      if (initialData) {
        setType(initialData.type);
        setDescription(initialData.description);
        setRuns(initialData.influenced_runs || "");
        setStatus(initialData.status);
        setIsEditing(false);
      } else {
        setType(ISSUE_TYPES[0]);
        setDescription("");
        setRuns("");
        setStatus(ISSUE_STATUSES[0]);
        setIsEditing(true);
      }
      setShowDeleteConfirm(false);
      setError(null);
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError("Please provide a description for the issue.");
      return;
    }
    setError(null);
    await onSubmit({
      type,
      description,
      influenced_runs: runs.trim() || null,
      status: isExisting ? status : undefined
    });
  };

  const handleDelete = async () => {
    if (onDelete && initialData) {
      await onDelete(initialData.id);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal-content issue-modal ${showDeleteConfirm ? 'delete-modal' : ''}`} onClick={(e) => e.stopPropagation()}>
        
        {showDeleteConfirm ? (
          <div className="delete-confirm-view">
            <div className="delete-confirm-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </div>
            <h2>Delete Issue</h2>
            <p>Are you sure you want to delete this issue? This action cannot be undone.</p>
            <div className="form-actions equal-buttons">
              <button className="btn secondary" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
              <button className="btn primary delete-btn" onClick={handleDelete} disabled={submitting}>
                {submitting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        ) : !isEditing && isExisting ? (
          <div className="issue-view-container">
            <div className="issue-view-header">
              <div className="issue-view-title">
                <h2>Issue Details</h2>
                <div className="issue-view-tags">
                  <span className={`issue-type type-${type.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`}>{type}</span>
                  <span className={`issue-status status-${status}`}>{status.replace("_", " ")}</span>
                </div>
              </div>
              <div className="modal-actions-top">
                <button className="icon-btn delete-icon-btn" onClick={() => setShowDeleteConfirm(true)} title="Delete Issue">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
                <button className="icon-btn" onClick={() => setIsEditing(true)} title="Edit Issue">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
                <button className="icon-btn" onClick={onClose} title="Close">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            </div>

            <div className="issue-view-body">
              <div className="view-section">
                <div className="view-section-title">Description</div>
                <div className="view-box-content runs-font">{description}</div>
              </div>

              <div className="view-section">
                <div className="view-section-title">Influenced Runs</div>
                <div className="view-box-content runs-font">{runs || "None specified"}</div>
              </div>
            </div>

            <div className="issue-view-footer">
              <div className="meta-text">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                Reported by {initialData.created_by} on {new Date(initialData.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
              </div>
              {initialData.last_changed_by && (
                <div className="meta-text">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  Last edited by {initialData.last_changed_by} {initialData.updated_at ? `on ${new Date(initialData.updated_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <h2>{!isExisting ? "Report an Issue" : "Edit Issue"}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                {isExisting && (
                  <div className="form-group half">
                    <label>Status</label>
                    <select value={status} onChange={(e) => setStatus(e.target.value)}>
                      {ISSUE_STATUSES.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                    </select>
                  </div>
                )}
                <div className={`form-group ${isExisting ? 'half' : ''}`}>
                  <label>Issue Type</label>
                  <select value={type} onChange={(e) => setType(e.target.value)}>
                    {ISSUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea
                  placeholder="Describe the issue..."
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    if (error) setError(null);
                  }}
                  rows={6}
                />
              </div>

              <div className="form-group">
                <label>Influenced Runs (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. 5x5 by Wolf, all even grids, etc."
                  value={runs}
                  onChange={(e) => setRuns(e.target.value)}
                />
              </div>

              {error && <div className="error-message" style={{ marginBottom: "16px" }}>{error}</div>}

              <div className="form-actions equal-buttons">
                <button type="button" className="btn secondary" onClick={() => {
                  if (isExisting) setIsEditing(false); else onClose();
                }}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={submitting}>
                  {submitting ? "Saving..." : (isExisting ? "Save Changes" : "Submit Report")}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
