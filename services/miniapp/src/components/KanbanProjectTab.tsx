/**
 * @fileoverview Project-scoped kanban tab for the regular Mini App workspace.
 *
 * Exports:
 * - KanbanProjectTab - Loads tasks for the selected project and exposes a secure shared-board shortcut.
 */

import { useEffect } from "react";

import { useKanban } from "../hooks/use-kanban";
import { ProjectRecord } from "../types";
import { KanbanBoard } from "./KanbanBoard";

type Props = {
  activeProject: ProjectRecord | null;
};

export const KanbanProjectTab = (props: Props) => {
  const {
    tasks,
    isLoading,
    isSaving,
    error,
    loadTasks,
    reloadTasks,
    createTask,
    updateTask,
    moveTask,
    createBoardLink
  } = useKanban();

  useEffect(() => {
    /* Project board follows the selected workspace project and reloads on every project change. */
    if (!props.activeProject) {
      return;
    }

    void loadTasks({ projectSlug: props.activeProject.slug });
  }, [loadTasks, props.activeProject]);

  if (!props.activeProject) {
    return <div className="placeholder">Select a project to open its kanban board.</div>;
  }

  return (
    <>
      {error ? <div className="alert">{error}</div> : null}

      <KanbanBoard
        scope="project"
        tasks={tasks}
        projects={[props.activeProject]}
        activeProjectSlug={props.activeProject.slug}
        isLoading={isLoading}
        isSaving={isSaving}
        onRefresh={() => void reloadTasks()}
        onCreateTask={(payload) => void createTask(payload)}
        onUpdateTask={(taskId, patch) => void updateTask(taskId, patch)}
        onMoveTask={(taskId, status) => void moveTask(taskId, status)}
        onOpenGlobalBoard={() => {
          void (async () => {
            try {
              const result = await createBoardLink(props.activeProject?.slug ?? null);
              if (!result?.url) {
                throw new Error("Secure board link is missing");
              }
              window.open(result.url, "_blank", "noopener,noreferrer");
            } catch (error) {
              console.error("Failed to open shared kanban board", error);
            }
          })();
        }}
      />
    </>
  );
};
