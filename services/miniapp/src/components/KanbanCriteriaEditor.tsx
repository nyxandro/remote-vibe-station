import { KeyboardEvent } from "react";
import { Plus, X, Check, EyeOff, Trash2, Ban } from "lucide-react";

import { KanbanCriterion } from "../types";

const ENTER_KEY = "Enter";
const SPACE_KEY = " ";

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
    if (event.key !== ENTER_KEY || props.draftValue.trim().length === 0) {
      return;
    }

    event.preventDefault();
    props.onAddCriterion();
  };

  const handleToggleKeyDown = (event: KeyboardEvent<HTMLDivElement>, criterionId: string, isBlocked: boolean) => {
    /* Keyboard access mirrors pointer toggles so checklist editing works without a mouse. */
    if (props.isSaving || isBlocked || (event.key !== ENTER_KEY && event.key !== SPACE_KEY)) {
      return;
    }

    event.preventDefault();
    props.onToggleDoneCriterion(criterionId);
  };

  return (
    <div className="kanban-criteria-editor">
      <div className="kanban-criteria-input-row">
        <input
          className="input kanban-criteria-input-field"
          aria-label="Acceptance criterion"
          placeholder="What's the definition of done for this?"
          value={props.draftValue}
          onChange={(event) => props.onDraftChange(event.target.value)}
          onKeyDown={handleDraftKeyDown}
        />

        <button
          className="kanban-criteria-add-button"
          disabled={props.draftValue.trim().length === 0 || props.isSaving}
          onClick={props.onAddCriterion}
          type="button"
          aria-label="Add criterion"
        >
          <Plus size={18} />
        </button>
      </div>

      {props.criteria.length > 0 ? (
        <ul className="kanban-criteria-list" aria-label="Acceptance criteria list">
          {props.criteria.map((criterion) => {
            const isDone = criterion.status === "done";
            const isBlocked = criterion.status === "blocked";
            const blockLabel = isBlocked
              ? `Unblock criterion`
              : `Block criterion`;

            return (
              <li 
                key={criterion.id} 
                className={`kanban-criteria-item ${isDone ? "is-done" : ""} ${isBlocked ? "is-blocked" : ""}`}
              >
                <div className="kanban-criteria-item-copy">
                  <div 
                    className="kanban-criteria-toggle-row"
                    role="button"
                    tabIndex={props.isSaving || isBlocked ? -1 : 0}
                    aria-label={`Toggle criterion ${criterion.text} done`}
                    onClick={() => !props.isSaving && !isBlocked && props.onToggleDoneCriterion(criterion.id)}
                    onKeyDown={(event) => handleToggleKeyDown(event, criterion.id, isBlocked)}
                  >
                    <div className="kanban-criteria-checkbox-wrapper">
                      {isDone && <Check size={14} strokeWidth={3} />}
                      {isBlocked && <Ban size={14} strokeWidth={3} />}
                    </div>
                    <span className="kanban-criteria-item-text">{criterion.text}</span>
                  </div>
                </div>

                <div className="kanban-criteria-item-actions">
                  <button
                    className={`kanban-criteria-action-btn ${isBlocked ? "is-active" : ""}`}
                    aria-label={blockLabel}
                    title={blockLabel}
                    disabled={props.isSaving || isDone}
                    onClick={() => props.onToggleBlockedCriterion(criterion.id)}
                    type="button"
                  >
                    <Ban size={16} />
                  </button>

                  <button
                    className="kanban-criteria-action-btn"
                    aria-label={`Remove criterion`}
                    title="Remove criterion"
                    disabled={props.isSaving}
                    onClick={() => props.onRemoveCriterion(criterion.id)}
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="kanban-criteria-empty">
          No criteria added yet. Add checklist items to define the scope of work.
        </div>
      )}
    </div>
  );
};
