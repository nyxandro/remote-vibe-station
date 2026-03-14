/**
 * @fileoverview Prompt builder for background kanban automation sessions.
 *
 * Exports:
 * - KanbanRunnerPromptTask - Minimal task snapshot needed for automation prompts.
 * - buildKanbanRunnerPrompt - Renders a resumable kanban execution prompt for OpenCode.
 */

import { KanbanTaskView } from "./kanban.types";

export type KanbanRunnerPromptTask = Pick<
  KanbanTaskView,
  | "id"
  | "projectSlug"
  | "projectName"
  | "title"
  | "description"
  | "status"
  | "priority"
  | "acceptanceCriteria"
  | "blockedReason"
  | "resultSummary"
>;

const formatCriteria = (task: KanbanRunnerPromptTask): string => {
  /* Stable ids keep continuation deterministic across fresh sessions. */
  if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0) {
    return "- No explicit criteria recorded yet. Refine the task into concrete criteria before claiming completion.";
  }

  return task.acceptanceCriteria
    .map((criterion) => `- ${criterion.id} | ${criterion.status} | ${criterion.text}`)
    .join("\n");
};

export const buildKanbanRunnerPrompt = (task: KanbanRunnerPromptTask): string => {
  /* Fresh-session prompts must contain all state needed to continue without chat-history assumptions. */
  return [
    `Continue kanban task ${task.id} for project ${task.projectSlug}.`,
    "",
    "Execution constraints:",
    "- This task is already claimed by the external kanban runner. Do not claim another task.",
    "- Work only on this task in this session.",
    "- Update acceptance-criterion states as you make real progress.",
    "- Mark the task done only when every criterion is done.",
    "- If any criterion cannot be completed without external help, mark that criterion blocked and block the task with the exact reason.",
    "- If the task is still unfinished when you stop, leave updated criteria and a concise progress summary so the next fresh session can continue.",
    "",
    `Task title: ${task.title}`,
    `Task status: ${task.status}`,
    `Priority: ${task.priority}`,
    task.description ? `Description: ${task.description}` : "Description: (empty)",
    task.blockedReason ? `Blocked reason: ${task.blockedReason}` : "Blocked reason: (none)",
    task.resultSummary ? `Current result summary: ${task.resultSummary}` : "Current result summary: (none)",
    "",
    "Acceptance criteria:",
    formatCriteria(task),
    "",
    "When you finish this session, ensure kanban state fully reflects reality."
  ].join("\n");
};
