/**
 * @fileoverview Checklist-style acceptance criteria editor for kanban tasks.
 *
 * Exports:
 * - KanbanCriteriaEditorProps - Public prop contract for checklist criteria editing.
 * - KanbanCriteriaEditor - Renders criterion draft input, status controls, and removable checklist items.
 */

import { KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";

import { KanbanCriterion } from "../types";

const ENTER_KEY = "Enter";

const humanizeCriterionStatus = (status: KanbanCriterion["status"]): string => {
  /* Compact labels help the editor surface blocked criteria without adding extra prose around each row. */
  switch (status) {
    case "pending":
      return "Pending";
    case "done":
      return "Done";
    case "blocked":
      return "Blocked";
  }
};

export type KanbanCriteriaEditorProps = {
  criteria: KanbanCriterion[];
  draftValue: string;
  isSaving: boolean;
  onDraftChange: (value: string) => void;
  onAddCriterion: () => void;
  onRemoveCriterion: (criterionId: string) => void;
  onToggleDoneCriterion: (criterionId: string) => void;
  onToggleBlockedCriterion: (criterionId: string) => void;
};

export const KanbanCriteriaEditor = (props: KanbanCriteriaEditorProps) => {
  const handleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    /* Enter should promote the current draft into a checklist item without submitting the whole task form. */
    if (event.key !== ENTER_KEY || props.draftValue.trim().length === 0) {
      return;
    }

    event.preventDefault();
    props.onAddCriterion();
  };

  return (
    <div className="kanban-field kanban-field-span-2">
      <span className="kanban-field-label">Acceptance criteria</span>

      <div className="kanban-criteria-editor">
        <div className="kanban-criteria-input-row">
          <input
            className="input"
            aria-label="Acceptance criterion"
            placeholder="Add one done criterion"
            value={props.draftValue}
            onChange={(event) => props.onDraftChange(event.target.value)}
            onKeyDown={handleDraftKeyDown}
          />

          <button
            className="btn outline kanban-criteria-add-button"
            disabled={props.draftValue.trim().length === 0 || props.isSaving}
            onClick={props.onAddCriterion}
            type="button"
          >
            <Plus size={16} />
            <span>Add criterion</span>
          </button>
        </div>

        <div className="kanban-criteria-hint">
          Add each checklist item separately so done means the same thing for humans, agents, and the automation runner.
        </div>

        {props.criteria.length > 0 ? (
          <ul className="kanban-criteria-list" aria-label="Acceptance criteria list">
            {props.criteria.map((criterion, index) => {
              const isDone = criterion.status === "done";
              const isBlocked = criterion.status === "blocked";
              const blockLabel = isBlocked
                ? `Return criterion ${criterion.text} to pending`
                : `Mark criterion ${criterion.text} as blocked`;

              return (
                <li key={criterion.id} className="kanban-criteria-item">
                  <div className="kanban-criteria-item-copy">
                    <span className="kanban-criteria-item-bullet" aria-hidden="true">
                      {index + 1}.
                    </span>

                    <div className="kanban-criteria-item-body">
                      <label className="kanban-criteria-toggle-row">
                        <input
                          aria-label={`Mark criterion ${criterion.text} as done`}
                          checked={isDone}
                          className="kanban-criteria-checkbox"
                          disabled={props.isSaving || isBlocked}
                          onChange={() => props.onToggleDoneCriterion(criterion.id)}
                          type="checkbox"
                        />
                        <span className="kanban-criteria-item-text">{criterion.text}</span>
                      </label>

                      <span className={`kanban-criteria-status kanban-criteria-status-${criterion.status}`}>
                        {humanizeCriterionStatus(criterion.status)}
                      </span>
                    </div>
                  </div>

                  <div className="kanban-criteria-item-actions">
                    <button
                      className="btn ghost kanban-criteria-status-button"
                      aria-label={blockLabel}
                      disabled={props.isSaving}
                      onClick={() => props.onToggleBlockedCriterion(criterion.id)}
                      type="button"
                    >
                      {isBlocked ? "Unblock" : "Block"}
                    </button>

                    <button
                      className="btn ghost kanban-criteria-remove-button"
                      aria-label={`Remove criterion ${criterion.text}`}
                      disabled={props.isSaving}
                      onClick={() => props.onRemoveCriterion(criterion.id)}
                      type="button"
                      title="Remove criterion"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="kanban-criteria-empty">No criteria added yet.</div>
        )}
      </div>
    </div>
  );
};
