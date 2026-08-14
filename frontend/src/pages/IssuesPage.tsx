import React, { useEffect, useState } from "react";
import { fetchIssues, submitIssue, updateIssue, deleteIssue, Issue } from "../api/api";
import { useAlias } from "../hooks/useAlias";
import { IssuesTable } from "../components/issues-page/IssuesTable";
import { IssueModal } from "../components/issues-page/IssueModal";
import { EmptyState } from "../components/issues-page/EmptyState";
import { OnboardingTooltip } from "../components/ui/OnboardingTooltip";
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

  const sortedIssues = [...issues].sort((a, b) => {
    const statusOrder: Record<string, number> = { "open": 1, "in_progress": 2, "closed": 3 };
    const orderA = statusOrder[a.status] || 4;
    const orderB = statusOrder[b.status] || 4;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="issues-page">
      <div className="issues-header">
        <div style={{ flex: 1 }}></div>
        {(issues.length > 0 || loading) && (
          <OnboardingTooltip
            tutorialKey="hasSeenFeatureRequest"
            position="bottom"
            content="💡 Tip: You can also use this page to submit feature requests!"
          >
            <button className="btn primary" onClick={openCreateModal}>
              Report Issue
            </button>
          </OnboardingTooltip>
        )}
      </div>

      <div style={{
        backgroundColor: "rgba(255, 193, 7, 0.1)",
        color: "#ffc107",
        padding: "12px",
        borderRadius: "8px",
        marginBottom: "16px",
        border: "1px solid rgba(255, 193, 7, 0.3)",
        textAlign: "center",
        fontSize: "0.95rem"
      }}>
        🚀 <strong>Notice:</strong> We just migrated our database from Render to Supabase! If you encounter any unexpected errors, please report them here.
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="issues-content">
        {loading ? (
          <div className="loading">Loading issues...</div>
        ) : issues.length === 0 ? (
          <EmptyState onReport={openCreateModal} />
        ) : (
          <IssuesTable issues={sortedIssues} onRowClick={openEditModal} />
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
