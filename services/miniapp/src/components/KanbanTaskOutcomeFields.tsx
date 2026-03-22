/**
 * @fileoverview Status-specific outcome inputs for the kanban task editor modal.
 *
 * Exports:
 * - KanbanTaskOutcomeFields - Renders result summary or blocker reason fields for terminal/problem stages.
 */

import { KanbanStatus } from "../types";

type Props = {
  status: KanbanStatus;
  resultSummary: string;
  blockedReason: string;
  onResultSummaryChange: (value: string) => void;
  onBlockedReasonChange: (value: string) => void;
};

export const KanbanTaskOutcomeFields = ({
  status,
  resultSummary,
  blockedReason,
  onResultSummaryChange,
  onBlockedReasonChange
}: Props) => {
  if (status !== "done" && status !== "blocked") {
    return null;
  }

  return (
    <section className="kanban-form-section">
      {status === "done" ? (
        <label className="kanban-field">
          <span className="kanban-field-label">Result summary</span>
          <textarea
            className="input kanban-textarea"
            aria-label="Result summary"
            placeholder="Summarize what was achieved..."
            value={resultSummary}
            onChange={(event) => onResultSummaryChange(event.target.value)}
          />
        </label>
      ) : null}

      {status === "blocked" ? (
        <label className="kanban-field">
          <span className="kanban-field-label">Blocked reason</span>
          <textarea
            className="input kanban-textarea"
            aria-label="Blocked reason"
            placeholder="Why is this task blocked?"
            value={blockedReason}
            onChange={(event) => onBlockedReasonChange(event.target.value)}
          />
        </label>
      ) : null}
    </section>
  );
};
