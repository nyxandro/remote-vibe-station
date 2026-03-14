/**
 * @fileoverview Shared project-resolution and task-decoration helpers for kanban services.
 *
 * Exports:
 * - decorateKanbanTasks - Adds human-readable project names to stored task records.
 * - resolveOptionalKanbanProjectSlug - Resolves explicit or directory-derived project scope.
 * - resolveRequiredKanbanProjectSlug - Enforces a resolvable project scope for scoped operations.
 */

import * as path from "node:path";

import { KanbanValidationError } from "./kanban.errors";
import { KanbanTaskRecord, KanbanTaskView } from "./kanban.types";
import { requireKanbanProjectSlug } from "./kanban-value-guards";

export const decorateKanbanTasks = (
  tasks: KanbanTaskRecord[],
  projects: Array<{ slug: string; name: string }>
): KanbanTaskView[] => {
  /* Task persistence should stay rename-stable, so display names are injected only at read time. */
  const projectNames = new Map(projects.map((project) => [project.slug, project.name]));
  return tasks.map((task) => ({
    ...task,
    projectName: projectNames.get(task.projectSlug) ?? task.projectSlug
  }));
};

export const resolveOptionalKanbanProjectSlug = (input: {
  projectSlug?: string | null;
  currentDirectory?: string | null;
  projects: Array<{ slug: string; rootPath: string }>;
}): string | null => {
  /* Directory-based inference keeps plugin calls concise while still staying project-scoped. */
  if (input.projectSlug && input.projectSlug.trim().length > 0) {
    return requireKanbanProjectSlug(input.projectSlug);
  }

  const currentDirectory = input.currentDirectory?.trim();
  if (!currentDirectory) {
    return null;
  }

  const resolvedDirectory = path.resolve(currentDirectory);
  const matching = input.projects
    .map((project) => ({ project, rootPath: path.resolve(project.rootPath) }))
    .filter(({ rootPath }) => resolvedDirectory === rootPath || resolvedDirectory.startsWith(`${rootPath}${path.sep}`))
    .sort((left, right) => right.rootPath.length - left.rootPath.length)[0];

  return matching?.project.slug ?? null;
};

export const resolveRequiredKanbanProjectSlug = (input: {
  projectSlug?: string | null;
  currentDirectory?: string | null;
  projects: Array<{ slug: string; rootPath: string }>;
}): string => {
  /* Claims and task creation must fail fast when project scope cannot be inferred safely. */
  const resolved = resolveOptionalKanbanProjectSlug(input);
  if (!resolved) {
    throw new KanbanValidationError("Project slug is required for this operation");
  }
  return resolved;
};
