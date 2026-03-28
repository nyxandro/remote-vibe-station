/**
 * @fileoverview Standalone browser-first kanban board screen opened by secure links.
 *
 * Exports:
 * - KanbanBoardScreen - Loads global board data and renders the shared Trello-like view.
 */

import { useEffect } from "react";

import { useKanban } from "../hooks/use-kanban";
import { useProjectCatalog } from "../hooks/use-project-catalog";
import { readStoredThemeMode, ThemeMode } from "../utils/theme";
import { KanbanBoard } from "./KanbanBoard";

type Props = {
  initialProjectSlug: string | null;
};

export const KanbanBoardScreen = (props: Props) => {
  const {
    tasks,
    isLoading,
    isSaving,
    error,
    loadTasks,
    createTask,
    deleteTask,
    updateTask,
    moveTask
  } = useKanban();
  const { projects, isLoading: isProjectsLoading, error: projectError, loadProjects } = useProjectCatalog();
  const themeMode: ThemeMode = readStoredThemeMode();

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
            <div className="panel-title">Shared Kanban [REFRESHED]</div>
            <div className="kanban-standalone-copy">
              One secure board for backlog storage, task planning, execution readiness, queue management, and agent work across all projects.
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
          initialProjectFilter={props.initialProjectSlug}
          isLoading={isLoading || isProjectsLoading}
          isSaving={isSaving}
          themeMode={themeMode}
          onCreateTask={(payload) => createTask(payload)}
          onDeleteTask={(taskId) => deleteTask(taskId)}
          onUpdateTask={(taskId, patch) => updateTask(taskId, patch)}
          onMoveTask={(taskId, status) => moveTask(taskId, status)}
        />
      </section>
    </div>
  );
};
