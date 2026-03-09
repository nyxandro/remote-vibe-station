/**
 * @fileoverview React hook for kanban board data loading and mutations.
 *
 * Exports:
 * - KanbanTaskFilter - Current server-side kanban list filter.
 * - CreateKanbanTaskPayload - Payload for new tasks.
 * - UpdateKanbanTaskPayload - Editable kanban fields.
 * - useKanban - Loads tasks and executes board mutations.
 */

import { useCallback, useRef, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { KanbanPriority, KanbanStatus, KanbanTask } from "../types";

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
  acceptanceCriteria: string[];
};

export type UpdateKanbanTaskPayload = {
  title?: string;
  description?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  acceptanceCriteria?: string[];
  resultSummary?: string | null;
  blockedReason?: string | null;
};

export const useKanban = () => {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const filterRef = useRef<KanbanTaskFilter>({});

  const loadTasks = useCallback(async (filter?: KanbanTaskFilter): Promise<void> => {
    /* Keep the last filter so mutations can refresh the currently visible board view automatically. */
    filterRef.current = filter ?? {};
    setIsLoading(true);
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
      setIsLoading(false);
    }
  }, []);

  const reloadTasks = useCallback(async (): Promise<void> => {
    /* Mutation handlers reuse the active filter to keep project/global boards in sync. */
    await loadTasks(filterRef.current);
  }, [loadTasks]);

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
      await mutate(async () => {
        await apiPost("/api/kanban/tasks", payload);
      });
    },
    [mutate]
  );

  const updateTask = useCallback(
    async (taskId: string, patch: UpdateKanbanTaskPayload): Promise<void> => {
      /* Backlog refinement and card edits share the same update endpoint. */
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
    moveTask,
    createBoardLink
  };
};
