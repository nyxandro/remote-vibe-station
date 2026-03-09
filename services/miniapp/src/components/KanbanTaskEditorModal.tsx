/**
 * @fileoverview Modal editor for creating and refining kanban tasks.
 *
 * Exports:
 * - KanbanTaskEditorSubmit - Payload emitted by the editor modal.
 * - KanbanTaskEditorModal - Shared create/edit dialog for project and global boards.
 */

import { useEffect, useState } from "react";

import { KanbanPriority, KanbanStatus, KanbanTask, ProjectRecord } from "../types";

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
  acceptanceCriteria: string[];
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

const splitCriteria = (value: string): string[] => {
  /* One criterion per line keeps both the UI textarea and agent tool payloads easy to reason about. */
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

export const KanbanTaskEditorModal = (props: Props) => {
  const [projectSlug, setProjectSlug] = useState<string>(props.activeProjectSlug ?? "");
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [status, setStatus] = useState<KanbanStatus>("backlog");
  const [priority, setPriority] = useState<KanbanPriority>("medium");
  const [criteriaText, setCriteriaText] = useState<string>("");
  const [resultSummary, setResultSummary] = useState<string>("");
  const [blockedReason, setBlockedReason] = useState<string>("");

  useEffect(() => {
    /* Reinitialize form state every time the dialog switches task or create/edit mode. */
    if (props.task) {
      setProjectSlug(props.task.projectSlug);
      setTitle(props.task.title);
      setDescription(props.task.description);
      setStatus(props.task.status);
      setPriority(props.task.priority);
      setCriteriaText(props.task.acceptanceCriteria.join("\n"));
      setResultSummary(props.task.resultSummary ?? "");
      setBlockedReason(props.task.blockedReason ?? "");
      return;
    }

    setProjectSlug(props.activeProjectSlug ?? "");
    setTitle("");
    setDescription("");
    setStatus("backlog");
    setPriority("medium");
    setCriteriaText("");
    setResultSummary("");
    setBlockedReason("");
  }, [props.activeProjectSlug, props.mode, props.task]);

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

          <label className="kanban-field kanban-field-span-2">
            <span className="kanban-field-label">Acceptance criteria</span>
            <textarea
              className="input kanban-textarea"
              aria-label="Acceptance criteria"
              value={criteriaText}
              onChange={(event) => setCriteriaText(event.target.value)}
              placeholder="One criterion per line"
            />
          </label>

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
              props.onSubmit({
                projectSlug: projectSlug.trim(),
                title: title.trim(),
                description: description.trim(),
                status,
                priority,
                acceptanceCriteria: splitCriteria(criteriaText),
                resultSummary: status === "done" ? resultSummary.trim() || null : null,
                blockedReason: status === "blocked" ? blockedReason.trim() || null : null
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
