/**
 * @fileoverview Tests for kanban execution timeline derivation in the Mini App.
 *
 * Exports:
 * - none (Vitest suite).
 */

import { describe, expect, it } from "vitest";

import { buildKanbanExecutionTimeline, formatKanbanDuration } from "../kanban-status-timeline";
import { KanbanTask } from "../../types";

const buildTask = (overrides?: Partial<KanbanTask>): KanbanTask => ({
  id: "task-1",
  projectSlug: "alpha",
  projectName: "Alpha",
  title: "Track timing",
  description: "Render compact task execution timeline.",
  status: "done",
  priority: "medium",
  acceptanceCriteria: [],
  resultSummary: "Done",
  blockedReason: null,
  createdAt: "2026-03-22T09:00:00.000Z",
  updatedAt: "2026-03-22T10:10:00.000Z",
  claimedBy: null,
  leaseUntil: null,
  executionSource: null,
  executionSessionId: null,
  statusTimeline: [
    { status: "queued", changedAt: "2026-03-22T09:00:00.000Z" },
    { status: "in_progress", changedAt: "2026-03-22T09:05:00.000Z" },
    { status: "blocked", changedAt: "2026-03-22T09:20:00.000Z" },
    { status: "queued", changedAt: "2026-03-22T09:40:00.000Z" },
    { status: "in_progress", changedAt: "2026-03-22T09:50:00.000Z" },
    { status: "done", changedAt: "2026-03-22T10:10:00.000Z" }
  ],
  ...overrides
});

describe("kanban execution timeline", () => {
  it("sums only active in-progress intervals across blocked reruns", () => {
    /* Total execution time should exclude pauses while the task sits blocked between attempts. */
    const timeline = buildKanbanExecutionTimeline(buildTask(), Date.parse("2026-03-22T10:10:00.000Z"));

    expect(timeline.totalActiveMs).toBe(35 * 60 * 1000);
    expect(formatKanbanDuration(timeline.totalActiveMs)).toBe("35m");
    expect(timeline.items.map((item) => item.status)).toEqual([
      "queued",
      "in_progress",
      "blocked",
      "queued",
      "in_progress",
      "done"
    ]);
    expect(timeline.items[1]).toMatchObject({
      status: "in_progress",
      durationMs: 15 * 60 * 1000,
      isActiveExecution: true
    });
    expect(timeline.items[2]).toMatchObject({
      status: "blocked",
      durationMs: 20 * 60 * 1000,
      isPausedExecution: true
    });
  });

  it("uses current time for an unfinished active execution segment", () => {
    /* Ongoing work should still expose the currently accumulated active duration inside the accordion header. */
    const timeline = buildKanbanExecutionTimeline(
      buildTask({
        status: "in_progress",
        updatedAt: "2026-03-22T10:00:00.000Z",
        statusTimeline: [
          { status: "queued", changedAt: "2026-03-22T09:00:00.000Z" },
          { status: "in_progress", changedAt: "2026-03-22T09:45:00.000Z" }
        ]
      }),
      Date.parse("2026-03-22T10:15:00.000Z")
    );

    expect(timeline.totalActiveMs).toBe(30 * 60 * 1000);
    expect(timeline.items.at(-1)).toMatchObject({
      status: "in_progress",
      durationMs: 30 * 60 * 1000,
      isCurrent: true
    });
  });
});
