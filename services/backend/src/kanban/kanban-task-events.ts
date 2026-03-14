/**
 * @fileoverview Shared helpers for publishing kanban task mutation events.
 *
 * Exports:
 * - KanbanTaskUpdatedEventData - Event payload shape consumed by the kanban runner.
 * - publishKanbanTaskUpdated - Emits one normalized task-updated event after a successful mutation.
 */

import { EventsService } from "../events/events.service";
import { KanbanTaskView } from "./kanban.types";

export type KanbanTaskUpdatedEventData = {
  taskId: string;
  taskTitle: string;
  projectSlug: string;
  status: string;
  claimedBy: string | null;
  source: "app" | "agent";
};

export const publishKanbanTaskUpdated = (
  events: EventsService,
  input: {
    task: KanbanTaskView;
    source: "app" | "agent";
  }
): void => {
  /* Normalize task mutation signals so runner wake-ups do not depend on controller-specific payload shapes. */
  events.publish({
    type: "kanban.task.updated",
    ts: new Date().toISOString(),
    data: {
      taskId: input.task.id,
      taskTitle: input.task.title,
      projectSlug: input.task.projectSlug,
      status: input.task.status,
      claimedBy: input.task.claimedBy ?? null,
      source: input.source
    } satisfies KanbanTaskUpdatedEventData
  });
};
