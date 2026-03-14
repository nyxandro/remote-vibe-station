/**
 * @fileoverview Workflow transition rules for kanban task statuses.
 *
 * Exports:
 * - KANBAN_ALLOWED_STATUS_TRANSITIONS - Explicit allowed next statuses for every board column.
 * - assertKanbanStatusTransition - Rejects invalid manual workflow jumps between columns.
 * - assertKanbanTaskCanEnterExecutionQueue - Ensures execution starts only from queued work.
 */

import { KanbanValidationError } from "./kanban.errors";
import { KanbanStatus, KanbanTaskRecord } from "./kanban.types";

export const KANBAN_ALLOWED_STATUS_TRANSITIONS: Record<KanbanStatus, readonly KanbanStatus[]> = {
  backlog: ["refinement"],
  refinement: ["backlog", "ready"],
  ready: ["refinement", "queued"],
  queued: ["ready", "in_progress"],
  in_progress: ["blocked", "done"],
  blocked: ["refinement", "ready", "queued"],
  done: ["refinement", "ready"]
};

export const assertKanbanStatusTransition = (input: {
  from: KanbanStatus;
  to: KanbanStatus;
  taskId: string;
}): void => {
  /* Workflow columns stay meaningful only when cards move through the agreed preparation and execution stages. */
  if (input.from === input.to) {
    return;
  }

  const allowed = KANBAN_ALLOWED_STATUS_TRANSITIONS[input.from];
  if (allowed.includes(input.to)) {
    return;
  }

  throw new KanbanValidationError(
    `KANBAN_STATUS_TRANSITION_NOT_ALLOWED: Task "${input.taskId}" cannot move from "${input.from}" to "${input.to}". Allowed next statuses: ${allowed.join(", ")}.`
  );
};

export const assertKanbanTaskCanEnterExecutionQueue = (task: KanbanTaskRecord): void => {
  /* Execution starts only from queued so backlog/refinement/ready stay explicit planning stages. */
  if (task.status === "queued" || task.status === "in_progress") {
    return;
  }

  throw new KanbanValidationError(
    `KANBAN_TASK_NOT_QUEUED_FOR_EXECUTION: Task "${task.id}" is in status "${task.status}". Move it to "queued" before starting execution.`
  );
};
