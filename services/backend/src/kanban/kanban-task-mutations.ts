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
import { resolveKanbanTaskStatus } from "./kanban-task-state";
import { KanbanCriterionStatus, KanbanTaskRecord, UpdateKanbanTaskInput } from "./kanban.types";
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
  const nextCriteria = Array.isArray(patch.acceptanceCriteria)
    ? normalizeCriterionInputs(patch.acceptanceCriteria, {
        existingCriteria: task.acceptanceCriteria,
        createId: () => crypto.randomUUID()
      })
    : task.acceptanceCriteria;
  const nextStatus = resolveKanbanTaskStatus({
    requestedStatus: patch.status ? requireKanbanStatus(patch.status) : task.status,
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

  /* Leaving active execution clears ownership so another session or runner may safely pick the card later. */
  if (nextStatus !== "in_progress") {
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
    task.status = "blocked";
    task.blockedReason = normalizeNullableKanbanText(input.blockedReason) ?? task.blockedReason;
    task.claimedBy = null;
    task.leaseUntil = null;
    task.executionSource = null;
    task.executionSessionId = null;
  } else {
    const requestedStatus = task.status === "blocked" ? (task.claimedBy ? "in_progress" : "queued") : task.status;
    task.status = resolveKanbanTaskStatus({
      requestedStatus,
      acceptanceCriteria: task.acceptanceCriteria
    });
    if (task.status !== "blocked") {
      task.blockedReason = null;
    }
  }

  task.updatedAt = new Date().toISOString();
};
