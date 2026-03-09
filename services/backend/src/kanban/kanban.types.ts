/**
 * @fileoverview Shared kanban task contracts for backend storage, API, and agent flows.
 *
 * Exports:
 * - KANBAN_STATUSES - Supported workflow states for human + agent execution.
 * - KanbanStatus - Union of workflow state values.
 * - KANBAN_PRIORITIES - Supported task priorities.
 * - KanbanPriority - Union of priority values.
 * - KanbanTaskRecord - Persisted task shape stored in JSON.
 * - KanbanTaskView - API-facing task with optional project name decoration.
 * - CreateKanbanTaskInput - Input for new task creation.
 * - UpdateKanbanTaskInput - Editable task fields.
 */

export const KANBAN_STATUSES = ["backlog", "queued", "in_progress", "blocked", "done"] as const;
export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

export const KANBAN_PRIORITIES = ["low", "medium", "high"] as const;
export type KanbanPriority = (typeof KANBAN_PRIORITIES)[number];

export type KanbanTaskRecord = {
  id: string;
  projectSlug: string;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  acceptanceCriteria: string[];
  resultSummary: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  claimedBy: string | null;
  leaseUntil: string | null;
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
  acceptanceCriteria: string[];
};

export type UpdateKanbanTaskInput = {
  title?: string;
  description?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  acceptanceCriteria?: string[];
  resultSummary?: string | null;
  blockedReason?: string | null;
};
