/**
 * @fileoverview Compact kanban status-timeline helpers for execution timing.
 *
 * Exports:
 * - buildInitialKanbanStatusTimeline - Seeds a new task with one current-stage timeline point.
 * - normalizeStoredKanbanStatusTimeline - Restores compact timeline data from JSON or legacy tasks.
 * - recordKanbanTaskStatusTransition - Appends only real status transitions to the persisted timeline.
 */

import { KANBAN_STATUSES, KanbanStatus, KanbanTaskRecord, KanbanTaskStatusTimelineEntry } from "./kanban.types";

const KANBAN_STATUS_SET = new Set<KanbanStatus>(KANBAN_STATUSES);

const isKanbanStatus = (value: unknown): value is KanbanStatus => {
  /* Store normalization accepts only declared workflow states so bogus JSON cannot poison timing math. */
  return typeof value === "string" && KANBAN_STATUS_SET.has(value as KanbanStatus);
};

const normalizeComparableTimestamp = (value: string | null | undefined): number | null => {
  /* Invalid timestamps must collapse to null so fallback seeding stays deterministic instead of using NaN. */
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveFallbackSeedTimestamp = (input: {
  createdAt: string;
  updatedAt: string;
  fallbackNowIso?: string;
}): string => {
  /* Legacy tasks get one conservative seed point at the last meaningful persisted timestamp we still trust. */
  const createdAtMs = normalizeComparableTimestamp(input.createdAt);
  const updatedAtMs = normalizeComparableTimestamp(input.updatedAt);

  if (createdAtMs !== null && updatedAtMs !== null) {
    return new Date(updatedAtMs > createdAtMs ? updatedAtMs : createdAtMs).toISOString();
  }
  if (updatedAtMs !== null) {
    return new Date(updatedAtMs).toISOString();
  }
  if (createdAtMs !== null) {
    return new Date(createdAtMs).toISOString();
  }

  return input.fallbackNowIso ?? new Date().toISOString();
};

const compactKanbanStatusTimeline = (
  entries: KanbanTaskStatusTimelineEntry[]
): KanbanTaskStatusTimelineEntry[] => {
  /* Consecutive duplicates add no timing value, so keep only the first point in each uninterrupted status span. */
  const compacted: KanbanTaskStatusTimelineEntry[] = [];

  for (const entry of entries) {
    const last = compacted.at(-1);
    if (last?.status === entry.status) {
      continue;
    }
    compacted.push(entry);
  }

  return compacted;
};

export const buildInitialKanbanStatusTimeline = (input: {
  status: KanbanStatus;
  changedAt: string;
}): KanbanTaskStatusTimelineEntry[] => {
  /* Fresh tasks only need the current workflow stage as the first timing checkpoint. */
  return [{ status: input.status, changedAt: input.changedAt }];
};

export const normalizeStoredKanbanStatusTimeline = (input: {
  storedTimeline: unknown;
  status: KanbanStatus;
  createdAt: string;
  updatedAt: string;
}): KanbanTaskStatusTimelineEntry[] => {
  /* Legacy tasks without timeline data still need one safe seed point so the UI can start tracking from now on. */
  const normalized = Array.isArray(input.storedTimeline)
    ? input.storedTimeline
        .map((entry) => {
          const record = entry as Partial<KanbanTaskStatusTimelineEntry> | null;
          if (!record || !isKanbanStatus(record.status) || typeof record.changedAt !== "string") {
            return null;
          }

          const changedAtMs = normalizeComparableTimestamp(record.changedAt);
          if (changedAtMs === null) {
            return null;
          }

          return {
            status: record.status,
            changedAt: new Date(changedAtMs).toISOString()
          } satisfies KanbanTaskStatusTimelineEntry;
        })
        .filter((entry): entry is KanbanTaskStatusTimelineEntry => entry !== null)
    : [];

  if (normalized.length > 0) {
    return compactKanbanStatusTimeline(normalized);
  }

  return buildInitialKanbanStatusTimeline({
    status: input.status,
    changedAt: resolveFallbackSeedTimestamp({
      createdAt: input.createdAt,
      updatedAt: input.updatedAt
    })
  });
};

export const recordKanbanTaskStatusTransition = (input: {
  task: Pick<KanbanTaskRecord, "status" | "createdAt" | "updatedAt" | "statusTimeline">;
  previousStatus: KanbanStatus;
  changedAt: string;
}): void => {
  /* Only actual status changes should grow the stored timeline so JSON stays compact over long task lifecycles. */
  const seededTimeline = normalizeStoredKanbanStatusTimeline({
    storedTimeline: input.task.statusTimeline,
    status: input.previousStatus,
    createdAt: input.task.createdAt,
    updatedAt: input.task.updatedAt
  });

  if (input.previousStatus === input.task.status) {
    input.task.statusTimeline = seededTimeline;
    return;
  }

  input.task.statusTimeline = compactKanbanStatusTimeline([
    ...seededTimeline,
    {
      status: input.task.status,
      changedAt: input.changedAt
    }
  ]);
};
