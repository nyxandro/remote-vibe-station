/**
 * @fileoverview Execution-ownership guards for kanban tasks driven by OpenCode sessions.
 *
 * Exports:
 * - KanbanExecutionActor - Identity used to validate who may mutate an active task.
 * - assertKanbanExecutionOwner - Rejects mutations from a non-owning OpenCode session.
 * - assertKanbanTaskCanStartExecution - Rejects duplicate execution starts across sessions.
 * - buildKanbanExecutionConflictMessage - Formats a human-readable ownership conflict error.
 */

import { KanbanExecutionConflictError } from "./kanban.errors";
import { KanbanExecutionSource, KanbanTaskRecord } from "./kanban.types";

export type KanbanExecutionActor = {
  agentId: string;
  sessionId: string | null;
  source: KanbanExecutionSource;
};

const normalizeSessionId = (value: string | null | undefined): string | null => {
  /* Session ids come from OpenCode runtime context, so only trimming is needed before comparisons. */
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
};

export const buildKanbanExecutionConflictMessage = (input: {
  task: KanbanTaskRecord;
  attemptedSource: KanbanExecutionSource;
}): string => {
  /* Conflict text must explain both the cause and the operator action required next. */
  const ownerSource = input.task.executionSource ?? "unknown";
  const ownerSessionId = normalizeSessionId(input.task.executionSessionId) ?? "unknown";
  return `KANBAN_EXECUTION_OWNERSHIP_CONFLICT: Task "${input.task.id}" is already owned by ${ownerSource} session "${ownerSessionId}". Refresh kanban state and continue only in the owning session.`;
};

const resolveLegacyOwnershipMismatch = (task: KanbanTaskRecord, actor: KanbanExecutionActor): boolean => {
  /* Legacy records may miss executionSessionId, so claimedBy is the safest fallback discriminator. */
  return Boolean(task.claimedBy) && task.claimedBy !== actor.agentId;
};

export const assertKanbanExecutionOwner = (input: {
  task: KanbanTaskRecord;
  actor: KanbanExecutionActor;
}): void => {
  /* Only the owning OpenCode session may mutate an active task's execution state or checklist. */
  if (input.task.status !== "in_progress") {
    return;
  }

  const ownerSessionId = normalizeSessionId(input.task.executionSessionId);
  const actorSessionId = normalizeSessionId(input.actor.sessionId);
  if (ownerSessionId && ownerSessionId !== actorSessionId) {
    throw new KanbanExecutionConflictError(
      buildKanbanExecutionConflictMessage({ task: input.task, attemptedSource: input.actor.source })
    );
  }

  if (!ownerSessionId && resolveLegacyOwnershipMismatch(input.task, input.actor)) {
    throw new KanbanExecutionConflictError(
      buildKanbanExecutionConflictMessage({ task: input.task, attemptedSource: input.actor.source })
    );
  }
};

export const assertKanbanTaskCanStartExecution = (input: {
  task: KanbanTaskRecord;
  actor: KanbanExecutionActor;
}): void => {
  /* Starting work is allowed only when the task is idle or already owned by the same OpenCode session. */
  if (input.task.status !== "in_progress") {
    return;
  }

  if (input.task.executionSource && input.task.executionSource !== input.actor.source) {
    throw new KanbanExecutionConflictError(
      buildKanbanExecutionConflictMessage({ task: input.task, attemptedSource: input.actor.source })
    );
  }

  assertKanbanExecutionOwner(input);
};
