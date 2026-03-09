/**
 * @fileoverview Standalone browser-first kanban board screen opened by secure links.
 *
 * Exports:
 * - KanbanBoardScreen - Loads global board data and renders the shared Trello-like view.
 */

import { useEffect } from "react";

import { useKanban } from "../hooks/use-kanban";
import { useProjectCatalog } from "../hooks/use-project-catalog";
import { useThemeMode } from "../hooks/use-theme-mode";
import { KanbanBoard } from "./KanbanBoard";

type Props = {
  initialProjectSlug: string | null;
};

export const KanbanBoardScreen = (props: Props) => {
  const { themeMode, setThemeMode } = useThemeMode();
  const {
    tasks,
    isLoading,
    isSaving,
    error,
    loadTasks,
    reloadTasks,
    createTask,
    updateTask,
    moveTask
  } = useKanban();
  const { projects, isLoading: isProjectsLoading, error: projectError, loadProjects } = useProjectCatalog();

  useEffect(() => {
    /* Shared board needs all tasks plus the full project catalog for filter/create controls. */
    void loadTasks();
    void loadProjects();
  }, [loadProjects, loadTasks]);

  return (
    <div className="app-shell">
      <section className="panel">
        <div className="kanban-standalone-header">
          <div>
            <div className="panel-title">Shared Kanban</div>
            <div className="kanban-standalone-copy">
              One secure board for backlog grooming, queue management, and agent execution across all projects.
            </div>
          </div>

          <button
            className="btn outline"
            onClick={() => {
              window.location.assign("/miniapp/");
            }}
            type="button"
          >
            Back to workspace
          </button>
        </div>

        {projectError ? <div className="alert">{projectError}</div> : null}
        {error ? <div className="alert">{error}</div> : null}

        <KanbanBoard
          scope="global"
          tasks={tasks}
          projects={projects}
          activeProjectSlug={null}
          themeMode={themeMode}
          onChangeTheme={setThemeMode}
          initialProjectFilter={props.initialProjectSlug}
          isLoading={isLoading || isProjectsLoading}
          isSaving={isSaving}
          onRefresh={() => {
            void reloadTasks();
            void loadProjects();
          }}
          onCreateTask={(payload) => void createTask(payload)}
          onUpdateTask={(taskId, patch) => void updateTask(taskId, patch)}
          onMoveTask={(taskId, status) => void moveTask(taskId, status)}
        />
      </section>
    </div>
  );
};
