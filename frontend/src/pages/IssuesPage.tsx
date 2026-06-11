import React, { useEffect, useState } from "react";
import { fetchIssues, submitIssue, updateIssue, deleteIssue, Issue } from "../api/api";
import { useAlias } from "../hooks/useAlias";
import { IssuesTable } from "../components/issues-page/IssuesTable";
import { IssueModal } from "../components/issues-page/IssueModal";
import { EmptyState } from "../components/issues-page/EmptyState";
import "./IssuesPage.css";

const IssuesPage: React.FC = () => {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { alias } = useAlias();

  useEffect(() => {
    loadIssues();
  }, []);

  const loadIssues = async () => {
    try {
      setLoading(true);
      const data = await fetchIssues();
      setIssues(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load issues.");
    } finally {
      setLoading(false);
    }
  };

  const handleModalSubmit = async (data: Partial<Issue>) => {
    try {
      setSubmitting(true);
      if (selectedIssue) {
        // Edit mode
        const updatedIssue = await updateIssue(selectedIssue.id, {
          ...data,
          last_changed_by: alias || "Anonymous"
        });
        setIssues(issues.map(i => i.id === updatedIssue.id ? updatedIssue : i));
      } else {
        // Create mode
        const newIssue = await submitIssue(
          data.type as string,
          data.description as string,
          data.influenced_runs as string | null,
          alias || "Anonymous"
        );
        setIssues([newIssue, ...issues]);
      }
      closeModal();
    } catch (err: any) {
      alert(`Failed to ${selectedIssue ? 'update' : 'submit'} issue: ` + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (issueId: number) => {
    try {
      setSubmitting(true);
      await deleteIssue(issueId);
      setIssues(issues.filter(i => i.id !== issueId));
      closeModal();
    } catch (err: any) {
      alert("Failed to delete issue: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openCreateModal = () => {
    setSelectedIssue(null);
    setIsModalOpen(true);
  };

  const openEditModal = (issue: Issue) => {
    setSelectedIssue(issue);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setTimeout(() => setSelectedIssue(null), 200); // Wait for transition
  };

  return (
    <div className="issues-page">
      <div className="issues-header">
        <div style={{ flex: 1 }}></div>
        {(issues.length > 0 || loading) && (
          <button className="btn primary" onClick={openCreateModal}>
            Report Issue
          </button>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="issues-content">
        {loading ? (
          <div className="loading">Loading issues...</div>
        ) : issues.length === 0 ? (
          <EmptyState onReport={openCreateModal} />
        ) : (
          <IssuesTable issues={issues} onRowClick={openEditModal} />
        )}
      </div>

      <IssueModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onSubmit={handleModalSubmit}
        onDelete={handleDelete}
        initialData={selectedIssue}
        submitting={submitting}
      />
    </div>
  );
};

export default IssuesPage;
