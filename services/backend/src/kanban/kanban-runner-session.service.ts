/**
 * @fileoverview Persistence helpers for binding active kanban tasks to OpenCode session ids.
 *
 * Exports:
 * - KanbanRunnerSessionService - Reads and updates per-task runner session bindings.
 */

import { Injectable } from "@nestjs/common";

import { KanbanValidationError } from "./kanban.errors";
import { KanbanStore } from "./kanban.store";

@Injectable()
export class KanbanRunnerSessionService {
  public constructor(private readonly store: KanbanStore) {}

  public async getTaskSessionId(taskId: string): Promise<string | null> {
    /* Task-owned session ids let the runner resume the same conversation after timer wake-ups or restarts. */
    const file = await this.store.read();
    const task = file.tasks.find((item) => item.id === taskId);
    return task?.executionSessionId ?? null;
  }

  public async setTaskSessionId(taskId: string, sessionId: string): Promise<void> {
    /* Persist the latest active session so the runner only rotates threads when a different task is claimed. */
    await this.store.transact((draft) => {
      const task = draft.tasks.find((item) => item.id === taskId);
      if (!task) {
        throw new KanbanValidationError(`Kanban task not found: ${taskId}`);
      }

      task.executionSessionId = sessionId;
    });
  }
}
