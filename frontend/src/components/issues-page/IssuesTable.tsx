import React from "react";
import { Issue } from "../../api/api";
import "./IssuesTable.css";

interface IssuesTableProps {
  issues: Issue[];
  onRowClick: (issue: Issue) => void;
}

export const IssuesTable: React.FC<IssuesTableProps> = ({ issues, onRowClick }) => {
  return (
    <table className="issues-table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Influenced Runs</th>
          <th>Status</th>
          <th>Reporter</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue) => (
          <tr key={issue.id} onClick={() => onRowClick(issue)} className="clickable-row">
            <td>
              <span className={`issue-type type-${issue.type.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`}>
                {issue.type}
              </span>
            </td>
            <td>{issue.influenced_runs || "-"}</td>
            <td>
              <span className={`issue-status status-${issue.status}`}>
                {issue.status.replace("_", " ")}
              </span>
            </td>
            <td>{issue.created_by}</td>
            <td className="issue-date">
              {new Date(issue.created_at).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
