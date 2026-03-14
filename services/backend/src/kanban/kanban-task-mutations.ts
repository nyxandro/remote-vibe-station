/**
 * @fileoverview Shared in-transaction kanban task mutation helpers.
 *
 * Exports:
 * - applyKanbanTaskPatch - Applies task field/status updates inside an existing store transaction.
 * - applyKanbanCriterionPatch - Applies criterion updates inside an existing store transaction.
 */

import * as crypto from "node:crypto";

import { normalizeCriterionInputs } from "./kanban-criteria";
import { KanbanValidationError } from "./kanban.errors";
import { assertKanbanStatusTransition } from "./kanban-status-transitions";
import { resolveKanbanTaskStatus } from "./kanban-task-state";
import { KanbanBlockedResumeStatus, KanbanCriterionStatus, KanbanTaskRecord, UpdateKanbanTaskInput } from "./kanban.types";
import {
  normalizeKanbanText,
  normalizeNullableKanbanText,
  requireKanbanCriterionId,
  requireKanbanCriterionStatus,
  requireKanbanPriority,
  requireKanbanStatus,
  requireKanbanTitle
} from "./kanban-value-guards";

export const applyKanbanTaskPatch = (task: KanbanTaskRecord, patch: UpdateKanbanTaskInput): void => {
  /* One shared patch path keeps status, criteria, and ownership cleanup consistent across all callers. */
  const previousStatus = task.status;
  const requestedStatus = patch.status ? requireKanbanStatus(patch.status) : task.status;
  assertKanbanStatusTransition({ from: task.status, to: requestedStatus, taskId: task.id });

  const nextCriteria = Array.isArray(patch.acceptanceCriteria)
    ? normalizeCriterionInputs(patch.acceptanceCriteria, {
        existingCriteria: task.acceptanceCriteria,
        createId: () => crypto.randomUUID()
      })
    : task.acceptanceCriteria;
  const nextStatus = resolveKanbanTaskStatus({
    requestedStatus,
    acceptanceCriteria: nextCriteria
  });

  if (typeof patch.title === "string") {
    task.title = requireKanbanTitle(patch.title);
  }
  if (typeof patch.description === "string") {
    task.description = normalizeKanbanText(patch.description);
  }
  if (typeof patch.priority === "string") {
    task.priority = requireKanbanPriority(patch.priority);
  }

  task.acceptanceCriteria = nextCriteria;
  task.status = nextStatus;

  /* Remember where blocked work should resume from so unblocking restores a sensible workflow state. */
  if (nextStatus === "blocked") {
    task.blockedResumeStatus = normalizeBlockedResumeStatusCandidate(
      previousStatus === "blocked" ? task.blockedResumeStatus ?? "queued" : previousStatus
    );
  } else {
    task.blockedResumeStatus = null;
  }

  /* Only truly idle/terminal states clear execution ownership; blocked tasks keep enough context for safe resume. */
  if (nextStatus !== "in_progress" && nextStatus !== "blocked") {
    task.claimedBy = null;
    task.leaseUntil = null;
    task.executionSource = null;
    task.executionSessionId = null;
  }

  /* Status-specific fields stay explicit so stale blocker/result notes never leak across phases. */
  task.resultSummary =
    nextStatus === "done"
      ? patch.resultSummary !== undefined
        ? normalizeNullableKanbanText(patch.resultSummary)
        : task.resultSummary
      : null;
  task.blockedReason =
    nextStatus === "blocked"
      ? patch.blockedReason !== undefined
        ? normalizeNullableKanbanText(patch.blockedReason)
        : task.blockedReason
      : null;
  task.updatedAt = new Date().toISOString();
};

export const applyKanbanCriterionPatch = (
  task: KanbanTaskRecord,
  tasks: KanbanTaskRecord[],
  input: {
    criterionId: string;
    status: KanbanCriterionStatus;
    blockedReason?: string | null;
  }
): void => {
  /* Criterion updates share one mutation path so blocked-state side effects stay deterministic. */
  const criterion = task.acceptanceCriteria.find((item) => item.id === requireKanbanCriterionId(input.criterionId));
  if (!criterion) {
    throw new KanbanValidationError(`Kanban criterion not found: ${input.criterionId}`);
  }

  const nextStatus = requireKanbanCriterionStatus(input.status);
  if (task.status === "done" && nextStatus !== "done") {
    throw new KanbanValidationError("Done tasks must be reopened before changing criterion status");
  }

  criterion.status = nextStatus;
  criterion.blockedReason = nextStatus === "blocked" ? normalizeNullableKanbanText(input.blockedReason) : null;

  if (nextStatus === "blocked") {
    /* Preserve the last non-blocked status so removing the blocker can restore a sane workflow state. */
    task.blockedResumeStatus = normalizeBlockedResumeStatusCandidate(
      task.status === "blocked" ? task.blockedResumeStatus ?? "queued" : task.status
    );
    task.status = "blocked";
    task.blockedReason = normalizeNullableKanbanText(input.blockedReason) ?? task.blockedReason;
  } else {
    const requestedStatus =
      task.status === "blocked"
        ? resolveBlockedResumeStatus({ task, tasks, nowMs: Date.now() })
        : task.status;
    task.status = resolveKanbanTaskStatus({
      requestedStatus,
      acceptanceCriteria: task.acceptanceCriteria
    });
    if (task.status !== "blocked") {
      task.blockedReason = null;
      task.blockedResumeStatus = null;
    }

    /* Once work is no longer active, clear stale execution ownership so later claims stay deterministic. */
    if (task.status !== "in_progress" && task.status !== "blocked") {
      task.claimedBy = null;
      task.leaseUntil = null;
      task.executionSource = null;
      task.executionSessionId = null;
    }
  }

  task.updatedAt = new Date().toISOString();
};

const resolveBlockedResumeStatus = (input: {
  task: KanbanTaskRecord;
  tasks: KanbanTaskRecord[];
  nowMs: number;
}): KanbanBlockedResumeStatus => {
  /* Blocked work should resume to its prior state when safe, but never create a second active task in one project. */
  const fallbackStatus = input.task.blockedResumeStatus ?? (input.task.claimedBy ? "in_progress" : "queued");
  if (fallbackStatus !== "in_progress") {
    return fallbackStatus;
  }

  /* Resuming active execution is safe only while the original lease still looks alive and no other task is already active. */
  const hasLiveOwner =
    Boolean(input.task.claimedBy && input.task.executionSource) &&
    Boolean(input.task.leaseUntil) &&
    Number.isFinite(Date.parse(input.task.leaseUntil ?? "")) &&
    Date.parse(input.task.leaseUntil ?? "") > input.nowMs;
  const hasAnotherActiveTask = input.tasks.some(
    (candidate) =>
      candidate.id !== input.task.id &&
      candidate.projectSlug === input.task.projectSlug &&
      candidate.status === "in_progress"
  );

  return hasLiveOwner && !hasAnotherActiveTask ? "in_progress" : "queued";
};

const normalizeBlockedResumeStatusCandidate = (
  value: KanbanTaskRecord["blockedResumeStatus"] | KanbanTaskRecord["status"]
): KanbanBlockedResumeStatus => {
  /* Done/blocked are not meaningful unblock targets, so collapse unexpected states to queued conservatively. */
  if (value === "backlog" || value === "refinement" || value === "ready" || value === "queued" || value === "in_progress") {
    return value;
  }

  return "queued";
};
