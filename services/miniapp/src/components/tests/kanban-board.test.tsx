/**
 * @fileoverview UI contract tests for kanban board interactions.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KanbanBoard } from "../KanbanBoard";
import { KanbanTask, ProjectRecord } from "../../types";

const buildProject = (overrides?: Partial<ProjectRecord>): ProjectRecord => ({
  id: "alpha",
  slug: "alpha",
  name: "Alpha",
  rootPath: "/srv/projects/alpha",
  hasCompose: true,
  configured: true,
  runnable: true,
  status: "running",
  ...overrides
});

const buildTask = (overrides?: Partial<KanbanTask>): KanbanTask => ({
  id: "task-1",
  projectSlug: "alpha",
  title: "Discuss backlog item",
  description: "Clarify acceptance criteria",
  status: "backlog",
  priority: "medium",
  acceptanceCriteria: ["One", "Two"],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-10T09:00:00.000Z",
  updatedAt: "2026-03-10T09:00:00.000Z",
  claimedBy: null,
  leaseUntil: null,
  projectName: "Alpha"
});

describe("KanbanBoard", () => {
  afterEach(() => {
    cleanup();
  });

  it("creates a backlog task for the active project", () => {
    /* Project-scoped board should default new cards to the selected project and backlog column. */
    const onCreateTask = vi.fn();

    render(
      <KanbanBoard
        scope="project"
        tasks={[]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        themeMode="light"
        onChangeTheme={vi.fn()}
        isLoading={false}
        isSaving={false}
        onRefresh={vi.fn()}
        onCreateTask={onCreateTask}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Prepare queue" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Move reviewed backlog item to queue" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    expect(onCreateTask).toHaveBeenCalledWith({
      projectSlug: "alpha",
      title: "Prepare queue",
      description: "Move reviewed backlog item to queue",
      status: "backlog",
      priority: "medium",
      acceptanceCriteria: []
    });
  });

  it("renders all workflow columns including agent execution states", () => {
    /* Human and agent users need one board that exposes backlog, queue, work, blockers, and completion. */
    render(
      <KanbanBoard
        scope="project"
        tasks={[buildTask()]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        themeMode="light"
        onChangeTheme={vi.fn()}
        isLoading={false}
        isSaving={false}
        onRefresh={vi.fn()}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    expect(screen.getByText("Backlog")).toBeTruthy();
    expect(screen.getByText("Queue")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("Discuss backlog item")).toBeTruthy();
  });
});
