/**
 * @fileoverview Helpers for browser-only Mini App standalone views.
 *
 * Exports:
 * - LaunchView - Supported top-level Mini App entry modes.
 * - readLaunchView - Reads the requested view from URL query params.
 * - readKanbanProjectFilter - Reads optional project filter for standalone kanban links.
 */

export type LaunchView = "workspace" | "kanban";

export const readLaunchView = (): LaunchView => {
  /* Non-browser contexts always fall back to the standard workspace shell. */
  if (typeof window === "undefined") {
    return "workspace";
  }

  const query = new URLSearchParams(window.location.search);
  return query.get("view") === "kanban" ? "kanban" : "workspace";
};

export const readKanbanProjectFilter = (): string | null => {
  /* Standalone board links may optionally open already filtered to a single project. */
  if (typeof window === "undefined") {
    return null;
  }

  const query = new URLSearchParams(window.location.search);
  const project = query.get("project");
  return project && project.trim().length > 0 ? project.trim() : null;
};
