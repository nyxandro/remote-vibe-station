/**
 * @fileoverview Prompt builder for continuing unfinished session-owned kanban work.
 *
 * Exports:
 * - buildKanbanSessionContinuationPrompt - Renders a strict follow-up prompt for the same OpenCode session.
 */

import { KanbanTaskView } from "./kanban.types";

const formatCriteria = (task: KanbanTaskView): string => {
  /* Stable criterion ids keep follow-up progress updates deterministic in the resumed turn. */
  if (task.acceptanceCriteria.length === 0) {
    return "- No explicit criteria recorded yet. Refine the task into concrete criteria before claiming it finished.";
  }

  return task.acceptanceCriteria.map((criterion) => `- ${criterion.id} | ${criterion.status} | ${criterion.text}`).join("\n");
};

export const buildKanbanSessionContinuationPrompt = (task: KanbanTaskView): string => {
  /* Same-session continuation must push execution forward instead of letting the agent stop at a progress note. */
  return [
    `Continue the current kanban task ${task.id} in this same session.`,
    "Do not switch to another task or start a new queue pickup right now.",
    "The task is still in progress, so keep working instead of stopping at a progress summary.",
    "Mark the task done only when every acceptance criterion is done.",
    "If you cannot continue without external help, block the exact criterion and block the task with the precise reason.",
    "If some criteria are already done, keep them done and finish only the remaining work.",
    "",
    `Task title: ${task.title}`,
    task.description ? `Description: ${task.description}` : "Description: (empty)",
    "Acceptance criteria:",
    formatCriteria(task)
  ].join("\n");
};
