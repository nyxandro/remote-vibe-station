/**
 * @fileoverview Modal editor for creating and planning kanban tasks.
 *
 * Exports:
 * - KanbanTaskEditorSubmit - Payload emitted by the editor modal.
 * - KanbanTaskEditorModal - Shared create/edit dialog for project and global boards.
 */

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  X,
  Layout,
  Type,
  AlignLeft,
  Flag,
  CheckCircle2,
  AlertCircle,
  Inbox,
  Filter,
  Zap,
  Clock,
  Play,
  Ban,
  Trash2
} from "lucide-react";
import { KanbanCriterion, KanbanCriterionStatus, KanbanPriority, KanbanStatus, KanbanTask, ProjectRecord } from "../types";
import {
  readStoredKanbanTaskEditorDraft,
  writeStoredKanbanTaskEditorDraft
} from "./kanban-task-editor-draft";
import { DangerConfirmModal } from "./DangerConfirmModal";
import { KanbanCriteriaEditor } from "./KanbanCriteriaEditor";
import { KanbanTaskOutcomeFields } from "./KanbanTaskOutcomeFields";
import { KanbanTaskTimelineAccordion } from "./KanbanTaskTimelineAccordion";
import { ThemeMode } from "../utils/theme";
const VisualMarkdownEditor = lazy(async () => ({
  default: (await import("./VisualMarkdownEditor")).VisualMarkdownEditor
}));
const STATUS_OPTIONS: Array<{ value: KanbanStatus; label: string; icon: any }> = [
  { value: "backlog", label: "Backlog", icon: Inbox },
  { value: "refinement", label: "Plan", icon: Filter },
  { value: "ready", label: "Ready", icon: Zap },
  { value: "queued", label: "Queue", icon: Clock },
  { value: "in_progress", label: "In progress", icon: Play },
  { value: "blocked", label: "Blocked", icon: Ban },
  { value: "done", label: "Done", icon: CheckCircle2 }
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
  themeMode?: ThemeMode;
  onClose: () => void;
  onSubmit: (payload: KanbanTaskEditorSubmit) => void;
  onDelete?: () => Promise<void> | void;
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

const buildSubmitCriteria = (input: {
  criteriaItems: KanbanCriterion[];
  criterionDraft: string;
}): KanbanCriterion[] => {
  /* Submit should persist the visible draft too, because users often click Save/Create without pressing the add button first. */
  const normalizedDraft = normalizeCriterion(input.criterionDraft);
  if (!normalizedDraft) {
    return input.criteriaItems;
  }

  /* Reuse the same shape as the explicit add action so backend normalization sees one consistent checklist payload. */
  return [
    ...input.criteriaItems,
    {
      id: createLocalCriterionId(),
      text: normalizedDraft,
      status: "pending"
    }
  ];
};

export const KanbanTaskEditorModal = (props: Props) => {
  const [projectSlug, setProjectSlug] = useState<string>(props.activeProjectSlug ?? "");
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [status, setStatus] = useState<KanbanStatus>("backlog");
  const [priority, setPriority] = useState<KanbanPriority>("medium");
  const [criteriaItems, setCriteriaItems] = useState<KanbanCriterion[]>([]);
  const [criterionDraft, setCriterionDraft] = useState<string>(DEFAULT_CRITERION_DRAFT);
  const [resultSummary, setResultSummary] = useState<string>("");
  const [blockedReason, setBlockedReason] = useState<string>("");
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState<boolean>(false);

  const resetCreateState = useCallback((nextProjectSlug: string) => {
    /* Fresh create sessions start from the requested project while keeping workflow defaults consistent. */
    setProjectSlug(nextProjectSlug);
    setTitle("");
    setDescription("");
    setStatus("backlog");
    setPriority("medium");
    setCriteriaItems([]);
    setCriterionDraft(DEFAULT_CRITERION_DRAFT);
    setResultSummary("");
    setBlockedReason("");
  }, []);

  const restoreStoredCreateDraft = useCallback(
    (nextProjectSlug: string): boolean => {
      /* Reopening the modal should revive the unfinished draft for the same project instead of forcing retyping. */
      const storedDraft = readStoredKanbanTaskEditorDraft({
        scope: props.scope,
        projectSlug: nextProjectSlug
      });
      if (!storedDraft) {
        return false;
      }

      setProjectSlug(storedDraft.projectSlug);
      setTitle(storedDraft.title);
      setDescription(storedDraft.description);
      setStatus(storedDraft.status);
      setPriority(storedDraft.priority);
      setCriteriaItems(storedDraft.acceptanceCriteria);
      setCriterionDraft(storedDraft.criterionDraft);
      setResultSummary(storedDraft.resultSummary);
      setBlockedReason(storedDraft.blockedReason);
      return true;
    },
    [props.scope]
  );

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
      setIsDeleteConfirmOpen(false);
      return;
    }

    const initialProjectSlug = props.activeProjectSlug ?? "";
    if (!restoreStoredCreateDraft(initialProjectSlug)) {
      resetCreateState(initialProjectSlug);
    }
  }, [props.activeProjectSlug, props.mode, props.task, resetCreateState, restoreStoredCreateDraft]);

  useEffect(() => {
    /* Only create mode persists drafts; edit mode must always reflect the saved task directly. */
    if (props.mode !== "create" || props.task) {
      return;
    }

    writeStoredKanbanTaskEditorDraft({
      scope: props.scope,
      projectSlug,
      draft: {
        projectSlug,
        title,
        description,
        status,
        priority,
        acceptanceCriteria: criteriaItems,
        criterionDraft,
        resultSummary,
        blockedReason
      }
    });
  }, [
    blockedReason,
    criteriaItems,
    criterionDraft,
    description,
    priority,
    projectSlug,
    props.mode,
    props.scope,
    props.task,
    resultSummary,
    status,
    title
  ]);

  const handleProjectChange = useCallback(
    (nextProjectSlug: string) => {
      /* Switching projects should restore that project's draft when it exists, otherwise keep the current text and just retarget it. */
      if (props.mode !== "create") {
        setProjectSlug(nextProjectSlug);
        return;
      }

      if (restoreStoredCreateDraft(nextProjectSlug)) {
        return;
      }

      setProjectSlug(nextProjectSlug);
    },
    [props.mode, restoreStoredCreateDraft]
  );

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

  const handleToggleDoneCriterion = useCallback((criterionId: string) => {
    /* Blocked criteria must be unblocked first so the task cannot jump straight from blocked to done. */
    setCriteriaItems((current) =>
      current.map((criterion) => {
        if (criterion.id !== criterionId) {
          return criterion;
        }

        if (criterion.status === "blocked") {
          return { ...criterion, status: "pending" as KanbanCriterionStatus };
        }

        return {
          ...criterion,
          status: (criterion.status === "done" ? "pending" : "done") as KanbanCriterionStatus
        };
      })
    );
  }, []);

  const handleToggleBlockedCriterion = useCallback((criterionId: string) => {
    /* Criterion blockers should force task blocking, while clearing the last blocker reopens normal status editing. */
    setCriteriaItems((current) => {
      const next = current.map((criterion) =>
        criterion.id === criterionId
          ? {
              ...criterion,
              status: (criterion.status === "blocked" ? "pending" : "blocked") as KanbanCriterionStatus
            }
          : criterion
      );

      /* We also update the task status if it's currently blocked or needs to be based on the new checklist state. */
      if (hasBlockedCriteria(next)) {
        setStatus("blocked");
      } else {
        setStatus((currentStatus) => (currentStatus === "blocked" ? "ready" : currentStatus));
      }

      return next;
    });
  }, []);

  const showProjectSelector = props.scope === "global";
  const submitLabel = props.mode === "create" ? "Create task" : "Save task";

  return (
    <div className="kanban-modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="kanban-modal" role="dialog" aria-modal="true" aria-labelledby="kanban-editor-title">
        <div className="kanban-modal-header">
          <div className="kanban-modal-header-content">
            <h2 id="kanban-editor-title" className="kanban-modal-title">
              {props.mode === "create" ? "New task" : "Edit task"}
            </h2>
            <button className="modal-close-btn" onClick={props.onClose} aria-label="Close modal">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="kanban-form-grid">
          {/* Keep fields grouped visually, but remove redundant section headings to reduce modal noise. */}
          <section className="kanban-form-section">
            {showProjectSelector ? (
              <label className="kanban-field">
                <span className="kanban-field-label">Project</span>
                <select className="input" value={projectSlug} onChange={(event) => handleProjectChange(event.target.value)}>
                  <option value="">Select project</option>
                  {props.projects.map((project) => (
                    <option key={project.id} value={project.slug}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="kanban-field">
              <span className="kanban-field-label">Title</span>
              <input 
                className="input" 
                aria-label="Title" 
                placeholder="What needs to be done?"
                value={title} 
                onChange={(event) => setTitle(event.target.value)} 
              />
            </label>

            <div className="kanban-field">
              <span className="kanban-field-label">Description</span>
              <Suspense fallback={<div className="placeholder">Loading editor...</div>}>
                <VisualMarkdownEditor
                  value={description}
                  themeMode={props.themeMode}
                  onChange={setDescription}
                  height="200px"
                />
              </Suspense>
            </div>
          </section>

          {/* Status and priority remain in their own block for scanning, without an extra heading. */}
          <section className="kanban-form-section">
            <div className="kanban-field">
              <span className="kanban-field-label">Status</span>
              <div className="kanban-segmented-control-status">
                {STATUS_OPTIONS.map((option) => (
                  <div
                    key={option.value}
                    className={`kanban-segment-status-item ${status === option.value ? "active" : ""}`}
                    onClick={() => setStatus(option.value)}
                    title={option.label}
                  >
                    <option.icon size={18} />
                    {status === option.value && (
                      <span className="kanban-segment-status-label">{option.label}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="kanban-field">
              <span className="kanban-field-label">Priority</span>
              <div className="kanban-segmented-control">
                {PRIORITY_OPTIONS.map((option) => (
                  <div
                    key={option.value}
                    className={`kanban-segment-item ${priority === option.value ? "active" : ""}`}
                    onClick={() => setPriority(option.value)}
                  >
                    {option.label}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Criteria Section */}
          <section className="kanban-form-section">
            <header className="kanban-form-section-title">Acceptance Criteria</header>
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
          </section>

          {/* Edit mode reveals execution timing while keeping the editor file within the 500-line limit. */}
          {props.task ? <KanbanTaskTimelineAccordion task={props.task} /> : null}

          {/* Status-specific outcome fields stay isolated in a dedicated component to keep the modal maintainable. */}
          <KanbanTaskOutcomeFields
            status={status}
            resultSummary={resultSummary}
            blockedReason={blockedReason}
            onResultSummaryChange={setResultSummary}
            onBlockedReasonChange={setBlockedReason}
          />
        </div>

        <div className="kanban-modal-actions">
          {props.task && props.onDelete ? (
            <button
              aria-label="Delete task"
              className="btn kanban-delete-icon-button"
              disabled={props.isSaving}
              onClick={() => setIsDeleteConfirmOpen(true)}
              title="Delete task"
              type="button"
            >
              <Trash2 size={16} />
            </button>
          ) : null}

          <button className="btn ghost" onClick={props.onClose} type="button">
            Cancel
          </button>

          <button
            className="btn primary"
            disabled={!title.trim() || !projectSlug.trim() || props.isSaving}
            onClick={() => {
              /* Persist the typed-but-not-yet-added draft before computing the final task status. */
              const submitCriteria = buildSubmitCriteria({
                criteriaItems,
                criterionDraft
              });
              const finalStatus = hasBlockedCriteria(submitCriteria) ? "blocked" : status;
              props.onSubmit({
                projectSlug: projectSlug.trim(),
                title: title.trim(),
                description: description.trim(),
                status: finalStatus,
                priority,
                acceptanceCriteria: submitCriteria,
                resultSummary: finalStatus === "done" ? resultSummary.trim() || null : null,
                blockedReason: finalStatus === "blocked" ? blockedReason.trim() || null : null
              });
            }}
            type="button"
          >
            {submitLabel}
          </button>
        </div>

        {isDeleteConfirmOpen && props.task && props.onDelete ? (
          <DangerConfirmModal
            title="Delete task permanently?"
            description="This removes the card from the shared board for everyone and cannot be undone."
            subjectLabel="Selected task"
            subjectTitle={props.task.title}
            subjectMeta={[props.task.projectName, STATUS_OPTIONS.find((option) => option.value === props.task?.status)?.label ?? props.task.status]}
            cancelLabel="Keep task"
            confirmLabel="Delete permanently"
            confirmBusyLabel="Deleting..."
            isBusy={props.isSaving}
            onClose={() => setIsDeleteConfirmOpen(false)}
            onConfirm={async () => {
              await props.onDelete?.();
            }}
          />
        ) : null}
      </div>
    </div>
  );
};
