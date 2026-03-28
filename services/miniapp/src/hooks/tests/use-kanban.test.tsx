/**
 * @fileoverview Tests for kanban hook live refresh behavior.
 *
 * Exports:
 * - none (Vitest suite).
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiDelete, apiGet, getEventStreamUrl } from "../../api/client";
import { useKanban } from "../use-kanban";

vi.mock("../../api/client", () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getEventStreamUrl: vi.fn()
}));

type MockSocketInstance = {
  onmessage: ((event: { data: string }) => void) | null;
  close: ReturnType<typeof vi.fn>;
};

class MockWebSocket {
  public static instances: MockSocketInstance[] = [];

  public onmessage: ((event: { data: string }) => void) | null = null;

  public close = vi.fn();

  public constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }
}

describe("useKanban", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.mocked(apiDelete).mockReset();
    vi.mocked(apiGet).mockReset();
    vi.mocked(getEventStreamUrl).mockReset().mockResolvedValue("ws://example.test/events?token=kanban");
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("silently reloads the active board when a matching kanban task update arrives", async () => {
    /* Live board refresh should follow the current project filter without forcing a manual refresh click. */
    vi.mocked(apiGet)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "task-1",
          projectSlug: "alpha",
          projectName: "Alpha",
          title: "Updated task",
          description: "",
          status: "ready",
          priority: "medium",
          acceptanceCriteria: [],
          resultSummary: null,
          blockedReason: null,
          createdAt: "2026-03-10T09:00:00.000Z",
          updatedAt: "2026-03-10T10:00:00.000Z",
          claimedBy: null,
          leaseUntil: null
        }
      ]);

    const { result } = renderHook(() => useKanban());

    await act(async () => {
      await result.current.loadTasks({ projectSlug: "alpha" });
      await Promise.resolve();
    });

    const socket = MockWebSocket.instances[0];
    expect(socket).toBeTruthy();

    act(() => {
      socket?.onmessage?.({
        data: JSON.stringify({
          type: "kanban.task.updated",
          data: { projectSlug: "alpha" }
        })
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiGet)).toHaveBeenNthCalledWith(1, "/api/kanban/tasks?projectSlug=alpha");
    expect(vi.mocked(apiGet)).toHaveBeenNthCalledWith(2, "/api/kanban/tasks?projectSlug=alpha");
    expect(result.current.tasks[0]?.title).toBe("Updated task");
  });

  it("ignores live updates from another project when the board is filtered to one project", async () => {
    /* Project-scoped boards should not reload for unrelated kanban events from other repos. */
    vi.mocked(apiGet).mockResolvedValueOnce([]);

    const { result } = renderHook(() => useKanban());

    await act(async () => {
      await result.current.loadTasks({ projectSlug: "alpha" });
      await Promise.resolve();
    });

    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.onmessage?.({
        data: JSON.stringify({
          type: "kanban.task.updated",
          data: { projectSlug: "beta" }
        })
      });
      vi.advanceTimersByTime(400);
    });

    expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(1);
  });

  it("deletes a task through the app endpoint and reloads the active board", async () => {
    /* User deletion should reuse the standard mutation pipeline so the visible kanban view stays in sync. */
    vi.mocked(apiGet)
      .mockResolvedValueOnce([
        {
          id: "task-1",
          projectSlug: "alpha",
          projectName: "Alpha",
          title: "Delete me",
          description: "",
          status: "queued",
          priority: "medium",
          acceptanceCriteria: [],
          resultSummary: null,
          blockedReason: null,
          createdAt: "2026-03-10T09:00:00.000Z",
          updatedAt: "2026-03-10T10:00:00.000Z",
          claimedBy: null,
          leaseUntil: null
        }
      ])
      .mockResolvedValueOnce([]);
    vi.mocked(apiDelete).mockResolvedValueOnce({ ok: true } as never);

    const { result } = renderHook(() => useKanban());

    await act(async () => {
      await result.current.loadTasks({ projectSlug: "alpha" });
    });

    await act(async () => {
      await result.current.deleteTask("task-1");
    });

    expect(vi.mocked(apiDelete)).toHaveBeenCalledWith("/api/kanban/tasks/task-1");
    expect(vi.mocked(apiGet)).toHaveBeenNthCalledWith(2, "/api/kanban/tasks?projectSlug=alpha");
    expect(result.current.tasks).toEqual([]);
  });
});
