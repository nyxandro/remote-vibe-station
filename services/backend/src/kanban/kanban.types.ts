/**
 * @fileoverview Shared kanban task contracts for backend storage, API, and agent flows.
 *
 * Exports:
 * - KANBAN_STATUSES - Supported workflow states for human + agent execution.
 * - KanbanStatus - Union of workflow state values.
 * - KANBAN_PRIORITIES - Supported task priorities.
 * - KanbanPriority - Union of priority values.
 * - KANBAN_CRITERION_STATUSES - Supported acceptance-criterion states.
 * - KanbanCriterionStatus - Union of criterion state values.
 * - KANBAN_EXECUTION_SOURCES - Supported task execution owners.
 * - KanbanExecutionSource - Union of execution owner values.
 * - KanbanCriterionRecord - Persisted checklist item for acceptance tracking.
 * - KanbanCriterionInput - Create/update input accepted from UI and agent tools.
 * - KanbanTaskRecord - Persisted task shape stored in JSON.
 * - KanbanTaskView - API-facing task with optional project name decoration.
 * - CreateKanbanTaskInput - Input for new task creation.
 * - UpdateKanbanTaskInput - Editable task fields.
 * - UpdateKanbanCriterionInput - Editable criterion state payload.
 */

export const KANBAN_STATUSES = ["backlog", "refinement", "ready", "queued", "in_progress", "blocked", "done"] as const;
export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

export const KANBAN_PRIORITIES = ["low", "medium", "high"] as const;
export type KanbanPriority = (typeof KANBAN_PRIORITIES)[number];

export const KANBAN_CRITERION_STATUSES = ["pending", "done", "blocked"] as const;
export type KanbanCriterionStatus = (typeof KANBAN_CRITERION_STATUSES)[number];

export const KANBAN_EXECUTION_SOURCES = ["session", "runner"] as const;
export type KanbanExecutionSource = (typeof KANBAN_EXECUTION_SOURCES)[number];

export type KanbanCriterionRecord = {
  id: string;
  text: string;
  status: KanbanCriterionStatus;
  blockedReason?: string | null;
};

export type KanbanCriterionInput =
  | string
  | {
      id?: string;
      text: string;
      status?: KanbanCriterionStatus;
      blockedReason?: string | null;
    };

export type KanbanTaskRecord = {
  id: string;
  projectSlug: string;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  acceptanceCriteria: KanbanCriterionRecord[];
  resultSummary: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  claimedBy: string | null;
  leaseUntil: string | null;
  executionSource: KanbanExecutionSource | null;
  executionSessionId: string | null;
};

export type KanbanTaskView = KanbanTaskRecord & {
  projectName: string;
};

export type CreateKanbanTaskInput = {
  projectSlug: string;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  acceptanceCriteria: KanbanCriterionInput[];
};

export type UpdateKanbanTaskInput = {
  title?: string;
  description?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  acceptanceCriteria?: KanbanCriterionInput[];
  resultSummary?: string | null;
  blockedReason?: string | null;
};

export type UpdateKanbanCriterionInput = {
  criterionId: string;
  status: KanbanCriterionStatus;
  blockedReason?: string | null;
};
