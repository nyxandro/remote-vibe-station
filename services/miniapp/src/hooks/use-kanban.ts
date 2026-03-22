/**
 * @fileoverview React hook for kanban board data loading and mutations.
 *
 * Exports:
 * - KanbanTaskFilter - Current server-side kanban list filter.
 * - CreateKanbanTaskPayload - Payload for new tasks.
 * - UpdateKanbanTaskPayload - Editable kanban fields.
 * - useKanban - Loads tasks and executes board mutations.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { apiGet, apiPost, getEventStreamUrl } from "../api/client";
import { KanbanCriterion, KanbanPriority, KanbanStatus, KanbanTask } from "../types";

export type KanbanTaskFilter = {
  projectSlug?: string | null;
  status?: KanbanStatus | null;
};

export type CreateKanbanTaskPayload = {
  projectSlug: string;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  acceptanceCriteria: KanbanCriterion[];
};

export type UpdateKanbanTaskPayload = {
  title?: string;
  description?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  acceptanceCriteria?: KanbanCriterion[];
  resultSummary?: string | null;
  blockedReason?: string | null;
};

export type UpdateKanbanCriterionPayload = {
  status: "pending" | "done" | "blocked";
  blockedReason?: string | null;
};

type KanbanTaskUpdatedEvent = {
  projectSlug?: string;
};

const LIVE_RELOAD_DEBOUNCE_MS = 350;
const INITIAL_WS_RECONNECT_DELAY_MS = 1_000;
const MAX_WS_RECONNECT_DELAY_MS = 10_000;

export const useKanban = () => {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const filterRef = useRef<KanbanTaskFilter>({});
  const liveReloadTimerRef = useRef<number | null>(null);
  const liveReconnectTimerRef = useRef<number | null>(null);

  const fetchTasks = useCallback(async (input: { filter?: KanbanTaskFilter; showLoading: boolean }): Promise<void> => {
    /* One shared fetch path keeps manual loads, mutation refreshes, and live updates in sync. */
    filterRef.current = input.filter ?? filterRef.current;
    if (input.showLoading) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const query = new URLSearchParams();
      if (filterRef.current.projectSlug) {
        query.set("projectSlug", filterRef.current.projectSlug);
      }
      if (filterRef.current.status) {
        query.set("status", filterRef.current.status);
      }

      const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
      const nextTasks = await apiGet<KanbanTask[]>(`/api/kanban/tasks${suffix}`);
      setTasks(nextTasks);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load kanban tasks");
    } finally {
      if (input.showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  const loadTasks = useCallback(async (filter?: KanbanTaskFilter): Promise<void> => {
    /* Keep the last filter so mutations can refresh the currently visible board view automatically. */
    await fetchTasks({ filter: filter ?? {}, showLoading: true });
  }, [fetchTasks]);

  const reloadTasks = useCallback(async (): Promise<void> => {
    /* Mutation handlers reuse the active filter to keep project/global boards in sync. */
    await fetchTasks({ showLoading: true });
  }, [fetchTasks]);

  const reloadTasksSilently = useCallback(async (): Promise<void> => {
    /* Live event refreshes should update the board without showing the full loading placeholder. */
    await fetchTasks({ showLoading: false });
  }, [fetchTasks]);

  useEffect(() => {
    /* Reuse the shared backend event stream so kanban columns react immediately to agent-side mutations. */
    let disposed = false;
    let reconnectDelayMs = INITIAL_WS_RECONNECT_DELAY_MS;
    let ws: WebSocket | null = null;

    const clearLiveReloadTimer = () => {
      /* Timer cleanup is shared between reconnects and effect teardown so no stale reload survives a closed socket. */
      if (liveReloadTimerRef.current !== null) {
        window.clearTimeout(liveReloadTimerRef.current);
        liveReloadTimerRef.current = null;
      }
    };

    const clearReconnectTimer = () => {
      /* Only one reconnect attempt should exist at a time even if the socket errors and closes in quick succession. */
      if (liveReconnectTimerRef.current !== null) {
        window.clearTimeout(liveReconnectTimerRef.current);
        liveReconnectTimerRef.current = null;
      }
    };

    const scheduleLiveReload = (eventProjectSlug?: string): void => {
      /* Project-filtered boards ignore unrelated task updates, while global boards refresh for every task mutation. */
      const activeProjectSlug = filterRef.current.projectSlug?.trim() || null;
      const normalizedEventProjectSlug = eventProjectSlug?.trim() || null;
      if (activeProjectSlug && normalizedEventProjectSlug && activeProjectSlug !== normalizedEventProjectSlug) {
        return;
      }

      clearLiveReloadTimer();
      liveReloadTimerRef.current = window.setTimeout(() => {
        void reloadTasksSilently();
      }, LIVE_RELOAD_DEBOUNCE_MS);
    };

    const connect = () => {
      /* Reconnect in-place so transient backend restarts do not leave the board permanently stale. */
      void (async () => {
        try {
          const url = await getEventStreamUrl({ topics: ["kanban"], projectSlug: filterRef.current.projectSlug });
          if (disposed) {
            return;
          }

          ws = new WebSocket(url);

          ws.onopen = () => {
            /* A healthy socket resets backoff so later disconnects recover quickly again. */
            reconnectDelayMs = INITIAL_WS_RECONNECT_DELAY_MS;
            clearReconnectTimer();
          };

          ws.onmessage = (event) => {
            try {
              const payload = JSON.parse(event.data) as { type?: string; data?: KanbanTaskUpdatedEvent };
              if (payload?.type !== "kanban.task.updated") {
                return;
              }

              scheduleLiveReload(payload.data?.projectSlug);
            } catch {
              /* Malformed non-kanban events should never break the board subscription loop. */
            }
          };

          ws.onerror = (event) => {
            /* WebSocket transport issues are informational here because onclose handles the actual retry loop. */
            console.error("Kanban live updates socket error", event);
          };

          ws.onclose = () => {
            /* Retry with capped backoff unless the hook is already being disposed. */
            ws = null;
            if (disposed) {
              return;
            }

            clearReconnectTimer();
            liveReconnectTimerRef.current = window.setTimeout(() => {
              connect();
            }, reconnectDelayMs);
            reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_WS_RECONNECT_DELAY_MS);
          };
        } catch {
          if (disposed) {
            return;
          }

          clearReconnectTimer();
          liveReconnectTimerRef.current = window.setTimeout(() => {
            connect();
          }, reconnectDelayMs);
          reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_WS_RECONNECT_DELAY_MS);
        }
      })();
    };

    connect();

    return () => {
      disposed = true;
      clearLiveReloadTimer();
      clearReconnectTimer();
      ws?.close();
    };
  }, [reloadTasksSilently]);

  const mutate = useCallback(
    async (request: () => Promise<unknown>): Promise<void> => {
      /* Centralize mutation state so create/edit/drag actions share identical UX feedback. */
      setIsSaving(true);
      setError(null);

      try {
        await request();
        await reloadTasks();
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "Failed to update kanban task";
        setError(message);
        throw nextError instanceof Error ? nextError : new Error(message);
      } finally {
        setIsSaving(false);
      }
    },
    [reloadTasks]
  );

  const createTask = useCallback(
    async (payload: CreateKanbanTaskPayload): Promise<void> => {
      /* New tasks are posted through the Mini App API and then the visible board refreshes in-place. */
      console.info("[useKanban] createTask", payload);
      await mutate(async () => {
        await apiPost("/api/kanban/tasks", payload);
      });
    },
    [mutate]
  );

  const updateTask = useCallback(
    async (taskId: string, patch: UpdateKanbanTaskPayload): Promise<void> => {
      /* Backlog refinement and card edits share the same update endpoint. */
      console.info("[useKanban] updateTask", taskId, patch);
      await mutate(async () => {
        await apiPost(`/api/kanban/tasks/${encodeURIComponent(taskId)}/update`, patch);
      });
    },
    [mutate]
  );

  const moveTask = useCallback(
    async (taskId: string, status: KanbanStatus): Promise<void> => {
      /* Drag-and-drop only needs a small status transition payload. */
      await mutate(async () => {
        await apiPost(`/api/kanban/tasks/${encodeURIComponent(taskId)}/move`, { status });
      });
    },
    [mutate]
  );

  const updateCriterion = useCallback(
    async (taskId: string, criterionId: string, payload: UpdateKanbanCriterionPayload): Promise<void> => {
      /* Criterion toggles share the same mutation lifecycle as task-level edits. */
      await mutate(async () => {
        await apiPost(
          `/api/kanban/tasks/${encodeURIComponent(taskId)}/criteria/${encodeURIComponent(criterionId)}/update`,
          payload
        );
      });
    },
    [mutate]
  );

  const createBoardLink = useCallback(async (projectSlug?: string | null): Promise<{ url: string }> => {
    /* Shared board links are generated on-demand so the browser token stays short-lived. */
    setError(null);

    try {
      return await apiPost<{ url: string }>("/api/kanban/board-link", { projectSlug: projectSlug ?? null });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Failed to create board link";
      setError(message);
      throw nextError;
    }
  }, []);

  return {
    tasks,
    isLoading,
    isSaving,
    error,
    clearError: () => setError(null),
    loadTasks,
    reloadTasks,
    createTask,
    updateTask,
    updateCriterion,
    moveTask,
    createBoardLink
  };
};
