/**
 * @fileoverview Modal editor for creating and refining kanban tasks.
 *
 * Exports:
 * - KanbanTaskEditorSubmit - Payload emitted by the editor modal.
 * - KanbanTaskEditorModal - Shared create/edit dialog for project and global boards.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { KanbanCriterion, KanbanPriority, KanbanStatus, KanbanTask, ProjectRecord } from "../types";
import { KanbanCriteriaEditor } from "./KanbanCriteriaEditor";

const STATUS_OPTIONS: Array<{ value: KanbanStatus; label: string }> = [
  { value: "backlog", label: "Backlog" },
  { value: "queued", label: "Queue" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" }
];

const PRIORITY_OPTIONS: Array<{ value: KanbanPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];

export type KanbanTaskEditorSubmit = {
  projectSlug: string;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  acceptanceCriteria: KanbanCriterion[];
  resultSummary: string | null;
  blockedReason: string | null;
};

type Props = {
  mode: "create" | "edit";
  scope: "project" | "global";
  activeProjectSlug: string | null;
  projects: ProjectRecord[];
  task?: KanbanTask | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (payload: KanbanTaskEditorSubmit) => void;
};

const DEFAULT_CRITERION_DRAFT = "";

const normalizeCriterion = (value: string): string => {
  /* Checklist criteria stay trimmed so stored task requirements remain stable across edits. */
  return value.trim();
};

const createLocalCriterionId = (): string => {
  /* UI ids only need to survive one editing session until the backend persists them. */
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `criterion-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const hasBlockedCriteria = (criteria: KanbanCriterion[]): boolean => {
  /* Criterion blockers should lift the entire task into blocked so the board reflects reality immediately. */
  return criteria.some((criterion) => criterion.status === "blocked");
};

export const KanbanTaskEditorModal = (props: Props) => {
  const [projectSlug, setProjectSlug] = useState<string>(props.activeProjectSlug ?? "");
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [status, setStatus] = useState<KanbanStatus>("backlog");
  const [priority, setPriority] = useState<KanbanPriority>("medium");
  const [criteriaItems, setCriteriaItems] = useState<KanbanCriterion[]>([]);
  const criteriaItemsRef = useRef<KanbanCriterion[]>([]);
  const [criterionDraft, setCriterionDraft] = useState<string>(DEFAULT_CRITERION_DRAFT);
  const [resultSummary, setResultSummary] = useState<string>("");
  const [blockedReason, setBlockedReason] = useState<string>("");

  useEffect(() => {
    /* Handlers read the ref to avoid stale criterion state during rapid consecutive toggles. */
    criteriaItemsRef.current = criteriaItems;
  }, [criteriaItems]);

  useEffect(() => {
    /* Reinitialize form state every time the dialog switches task or create/edit mode. */
    if (props.task) {
      setProjectSlug(props.task.projectSlug);
      setTitle(props.task.title);
      setDescription(props.task.description);
      setStatus(props.task.status);
      setPriority(props.task.priority);
      setCriteriaItems(props.task.acceptanceCriteria);
      setCriterionDraft(DEFAULT_CRITERION_DRAFT);
      setResultSummary(props.task.resultSummary ?? "");
      setBlockedReason(props.task.blockedReason ?? "");
      return;
    }

    setProjectSlug(props.activeProjectSlug ?? "");
    setTitle("");
    setDescription("");
    setStatus("backlog");
    setPriority("medium");
    setCriteriaItems([]);
    setCriterionDraft(DEFAULT_CRITERION_DRAFT);
    setResultSummary("");
    setBlockedReason("");
  }, [props.activeProjectSlug, props.mode, props.task]);

  const handleAddCriterion = useCallback(() => {
    /* New checklist items are appended explicitly so the user sees the exact done-definition being saved. */
    const normalized = normalizeCriterion(criterionDraft);
    if (!normalized) {
      return;
    }

    setCriteriaItems((current) => [
      ...current,
      {
        id: createLocalCriterionId(),
        text: normalized,
        status: "pending"
      }
    ]);
    setCriterionDraft(DEFAULT_CRITERION_DRAFT);
  }, [criterionDraft]);

  const handleRemoveCriterion = useCallback((criterionId: string) => {
    /* Removal is id-based so persisted criterion statuses survive reordering and future automation sessions. */
    setCriteriaItems((current) => current.filter((criterion) => criterion.id !== criterionId));
  }, []);

  const handleToggleDoneCriterion = useCallback(
    (criterionId: string) => {
      /* Blocked criteria must be unblocked first so the task cannot jump straight from blocked to done. */
      const next = criteriaItemsRef.current.map((criterion) => {
          if (criterion.id !== criterionId) {
            return criterion;
          }

          if (criterion.status === "blocked") {
            return { ...criterion, status: "pending" };
          }

          return {
            ...criterion,
            status: criterion.status === "done" ? "pending" : "done"
          };
        });

      criteriaItemsRef.current = next;
      setCriteriaItems(next);
    },
    []
  );

  const handleToggleBlockedCriterion = useCallback(
    (criterionId: string) => {
      /* Criterion blockers should force task blocking, while clearing the last blocker reopens normal status editing. */
      const next = criteriaItemsRef.current.map((criterion) =>
        criterion.id === criterionId
          ? {
              ...criterion,
              status: criterion.status === "blocked" ? "pending" : "blocked"
            }
          : criterion
      );

      criteriaItemsRef.current = next;
      setCriteriaItems(next);
      setStatus((currentStatus) => {
        if (hasBlockedCriteria(next)) {
          return "blocked";
        }
        return currentStatus === "blocked" ? "backlog" : currentStatus;
      });
    },
    []
  );

  const showProjectSelector = props.scope === "global";
  const submitLabel = props.mode === "create" ? "Create task" : "Save task";

  return (
    <div className="kanban-modal-backdrop" role="presentation">
      <div className="kanban-modal" role="dialog" aria-modal="true" aria-labelledby="kanban-editor-title">
        <div className="kanban-modal-header">
          <h2 id="kanban-editor-title" className="kanban-modal-title">
            {props.mode === "create" ? "New task" : "Edit task"}
          </h2>
        </div>

        <div className="kanban-form-grid">
          {showProjectSelector ? (
            <label className="kanban-field">
              <span className="kanban-field-label">Project</span>
              <select className="input" value={projectSlug} onChange={(event) => setProjectSlug(event.target.value)}>
                <option value="">Select project</option>
                {props.projects.map((project) => (
                  <option key={project.id} value={project.slug}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="kanban-field kanban-field-span-2">
            <span className="kanban-field-label">Title</span>
            <input className="input" aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label className="kanban-field kanban-field-span-2">
            <span className="kanban-field-label">Description</span>
            <textarea
              className="input kanban-textarea"
              aria-label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <label className="kanban-field">
            <span className="kanban-field-label">Status</span>
            <select className="input" value={status} onChange={(event) => setStatus(event.target.value as KanbanStatus)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="kanban-field">
            <span className="kanban-field-label">Priority</span>
            <select className="input" value={priority} onChange={(event) => setPriority(event.target.value as KanbanPriority)}>
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <KanbanCriteriaEditor
            criteria={criteriaItems}
            draftValue={criterionDraft}
            isSaving={props.isSaving}
            onDraftChange={setCriterionDraft}
            onAddCriterion={handleAddCriterion}
            onRemoveCriterion={handleRemoveCriterion}
            onToggleDoneCriterion={handleToggleDoneCriterion}
            onToggleBlockedCriterion={handleToggleBlockedCriterion}
          />

          {status === "done" ? (
            <label className="kanban-field kanban-field-span-2">
              <span className="kanban-field-label">Result summary</span>
              <textarea
                className="input kanban-textarea"
                aria-label="Result summary"
                value={resultSummary}
                onChange={(event) => setResultSummary(event.target.value)}
              />
            </label>
          ) : null}

          {status === "blocked" ? (
            <label className="kanban-field kanban-field-span-2">
              <span className="kanban-field-label">Blocked reason</span>
              <textarea
                className="input kanban-textarea"
                aria-label="Blocked reason"
                value={blockedReason}
                onChange={(event) => setBlockedReason(event.target.value)}
              />
            </label>
          ) : null}
        </div>

        <div className="kanban-modal-actions">
          <button className="btn ghost" onClick={props.onClose} type="button">
            Cancel
          </button>

          <button
            className="btn primary"
            disabled={!title.trim() || !projectSlug.trim() || props.isSaving}
            onClick={() => {
              const finalStatus = hasBlockedCriteria(criteriaItems) ? "blocked" : status;
              props.onSubmit({
                projectSlug: projectSlug.trim(),
                title: title.trim(),
                description: description.trim(),
                status: finalStatus,
                priority,
                acceptanceCriteria: criteriaItems,
                resultSummary: finalStatus === "done" ? resultSummary.trim() || null : null,
                blockedReason: finalStatus === "blocked" ? blockedReason.trim() || null : null
              });
            }}
            type="button"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
