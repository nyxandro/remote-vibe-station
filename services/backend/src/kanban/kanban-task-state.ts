/**
 * @fileoverview Shared kanban task-state helpers for ordering, lease expiry, and completion gating.
 *
 * Exports:
 * - compareKanbanTasks - Stable queue ordering shared by board rendering and claim-next.
 * - releaseExpiredKanbanLeases - Returns stale in-progress tasks back to queue.
 * - resolveKanbanTaskStatus - Applies criterion-driven task-state invariants.
 */

import { areAllCriteriaDone, hasBlockedCriteria } from "./kanban-criteria";
import { KanbanCriterionRecord, KanbanPriority, KanbanStatus, KanbanTaskRecord } from "./kanban.types";
import { KanbanValidationError } from "./kanban.errors";

const PRIORITY_WEIGHT: Record<KanbanPriority, number> = {
  low: 1,
  medium: 2,
  high: 3
};

const normalizeComparableTimestamp = (value: string): number => {
  /* Invalid timestamps should sort deterministically instead of poisoning comparisons with NaN. */
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const compareKanbanTasks = (left: KanbanTaskRecord, right: KanbanTaskRecord): number => {
  /* Keep visual board order identical to claim order so humans understand what the agent will pick next. */
  const priorityDelta = PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const updatedDelta = normalizeComparableTimestamp(left.updatedAt) - normalizeComparableTimestamp(right.updatedAt);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  const createdDelta = normalizeComparableTimestamp(left.createdAt) - normalizeComparableTimestamp(right.createdAt);
  if (createdDelta !== 0) {
    return createdDelta;
  }

  return left.title.localeCompare(right.title);
};

export const releaseExpiredKanbanLeases = (tasks: KanbanTaskRecord[], nowMs: number): void => {
  /* Expired in-progress cards are returned to queued so another agent can continue the work. */
  for (const task of tasks) {
    if (task.status !== "in_progress" || !task.leaseUntil) {
      continue;
    }

    const leaseUntilMs = Date.parse(task.leaseUntil);
    if (!Number.isFinite(leaseUntilMs) || leaseUntilMs > nowMs) {
      continue;
    }

    task.status = "queued";
    task.claimedBy = null;
    task.leaseUntil = null;
    task.updatedAt = new Date(nowMs).toISOString();
  }
};

export const resolveKanbanTaskStatus = (input: {
  requestedStatus: KanbanStatus;
  acceptanceCriteria: KanbanCriterionRecord[];
}): KanbanStatus => {
  /* Criterion blockers win over any requested state, while completion requires every box to be done. */
  if (hasBlockedCriteria(input.acceptanceCriteria)) {
    return "blocked";
  }
  if (input.requestedStatus === "done" && !areAllCriteriaDone(input.acceptanceCriteria)) {
    throw new KanbanValidationError("Task cannot be marked done until every acceptance criterion is done");
  }
  return input.requestedStatus;
};
