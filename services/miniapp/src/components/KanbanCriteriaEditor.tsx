/**
 * @fileoverview Checklist-style acceptance criteria editor for kanban tasks.
 *
 * Exports:
 * - KanbanCriteriaEditorProps - Public prop contract for checklist criteria editing.
 * - KanbanCriteriaEditor - Renders criterion draft input, explicit add action, and removable checklist items.
 */

import { KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";

const ENTER_KEY = "Enter";

export type KanbanCriteriaEditorProps = {
  criteria: string[];
  draftValue: string;
  isSaving: boolean;
  onDraftChange: (value: string) => void;
  onAddCriterion: () => void;
  onRemoveCriterion: (index: number) => void;
};

export const KanbanCriteriaEditor = (props: KanbanCriteriaEditorProps) => {
  const handleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    /* Enter should promote the current draft into a checklist item without submitting the whole task form. */
    if (event.key !== ENTER_KEY) {
      return;
    }

    if (props.draftValue.trim().length === 0) {
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

        <div className="kanban-criteria-hint">Add each checklist item separately so done means the same thing for humans and agents.</div>

        {props.criteria.length > 0 ? (
          <ul className="kanban-criteria-list" aria-label="Acceptance criteria list">
            {props.criteria.map((criterion, index) => (
              <li key={`${criterion}-${index}`} className="kanban-criteria-item">
                <div className="kanban-criteria-item-copy">
                  <span className="kanban-criteria-item-bullet" aria-hidden="true">
                    {index + 1}.
                  </span>
                  <span className="kanban-criteria-item-text">{criterion}</span>
                </div>

                <button
                  className="btn ghost kanban-criteria-remove-button"
                  aria-label={`Remove criterion ${criterion}`}
                  disabled={props.isSaving}
                  onClick={() => props.onRemoveCriterion(index)}
                  type="button"
                  title="Remove criterion"
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="kanban-criteria-empty">No criteria added yet.</div>
        )}
      </div>
    </div>
  );
};
