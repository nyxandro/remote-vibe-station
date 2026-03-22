/**
 * @fileoverview Derives compact execution timing summaries from kanban status transitions.
 *
 * Exports:
 * - KanbanExecutionTimelineItem - One rendered stage segment with derived duration metadata.
 * - KanbanExecutionTimeline - Timeline payload used by the task editor accordion.
 * - buildKanbanExecutionTimeline - Converts stored status points into UI-ready segments and total active time.
 * - formatKanbanDuration - Formats millisecond durations into compact human-readable labels.
 * - getKanbanStatusTimelineLabel - Maps workflow statuses to readable timeline labels.
 */

import { KanbanStatus, KanbanTask, KanbanTaskStatusTimelineEntry } from "../types";

const ACTIVE_EXECUTION_STATUS: KanbanStatus = "in_progress";
const PAUSED_EXECUTION_STATUS: KanbanStatus = "blocked";

export type KanbanExecutionTimelineItem = {
  status: KanbanStatus;
  label: string;
  changedAt: string;
  durationMs: number;
  isCurrent: boolean;
  isActiveExecution: boolean;
  isPausedExecution: boolean;
};

export type KanbanExecutionTimeline = {
  items: KanbanExecutionTimelineItem[];
  totalActiveMs: number;
};

const parseTimestampMs = (value: string): number => {
  /* Timeline math should stay deterministic even if a malformed timestamp sneaks into an old task payload. */
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeTimeline = (task: KanbanTask): KanbanTaskStatusTimelineEntry[] => {
  /* Tasks without stored transitions still get one fallback point so the accordion can render safely. */
  if (!Array.isArray(task.statusTimeline) || task.statusTimeline.length === 0) {
    return [{ status: task.status, changedAt: new Date(parseTimestampMs(task.updatedAt)).toISOString() }];
  }

  return task.statusTimeline
    .map((entry) => ({
      status: entry.status,
      changedAt: new Date(parseTimestampMs(entry.changedAt)).toISOString()
    }))
    .sort((left, right) => parseTimestampMs(left.changedAt) - parseTimestampMs(right.changedAt));
};

export const formatKanbanDuration = (durationMs: number): string => {
  /* Compact labels keep the accordion summary readable without wasting horizontal space. */
  const safeDurationMs = Math.max(0, durationMs);
  const totalMinutes = Math.floor(safeDurationMs / 60_000);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalDays > 0) {
    const remainingHours = totalHours % 24;
    return remainingHours > 0 ? `${totalDays}d ${remainingHours}h` : `${totalDays}d`;
  }
  if (totalHours > 0) {
    const remainingMinutes = totalMinutes % 60;
    return remainingMinutes > 0 ? `${totalHours}h ${remainingMinutes}m` : `${totalHours}h`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m`;
  }

  const totalSeconds = Math.max(0, Math.floor(safeDurationMs / 1000));
  return totalSeconds > 0 ? `${totalSeconds}s` : "0m";
};

export const getKanbanStatusTimelineLabel = (status: KanbanStatus): string => {
  /* Reuse human-readable labels so the timing accordion matches the existing kanban workflow naming. */
  switch (status) {
    case "backlog":
      return "Backlog";
    case "refinement":
      return "Refinement";
    case "ready":
      return "Ready";
    case "queued":
      return "Queued";
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
    default:
      return status;
  }
};

export const buildKanbanExecutionTimeline = (task: KanbanTask, nowMs: number = Date.now()): KanbanExecutionTimeline => {
  /* Derive durations client-side from compact transition points so backend storage stays minimal. */
  const timeline = normalizeTimeline(task);
  let totalActiveMs = 0;

  const items = timeline.map((entry, index) => {
    const changedAtMs = parseTimestampMs(entry.changedAt);
    const nextChangedAtMs = timeline[index + 1]
      ? parseTimestampMs(timeline[index + 1].changedAt)
      : entry.status === "done"
        ? changedAtMs
        : nowMs;
    const durationMs = Math.max(0, nextChangedAtMs - changedAtMs);
    const isActiveExecution = entry.status === ACTIVE_EXECUTION_STATUS;
    const isPausedExecution = entry.status === PAUSED_EXECUTION_STATUS;

    if (isActiveExecution) {
      totalActiveMs += durationMs;
    }

    return {
      status: entry.status,
      label: getKanbanStatusTimelineLabel(entry.status),
      changedAt: entry.changedAt,
      durationMs,
      isCurrent: index === timeline.length - 1,
      isActiveExecution,
      isPausedExecution
    } satisfies KanbanExecutionTimelineItem;
  });

  return {
    items,
    totalActiveMs
  };
};
