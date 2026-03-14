/**
 * @fileoverview UI contract tests for kanban board interactions.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KanbanBoard } from "../KanbanBoard";
import { KanbanTask, ProjectRecord } from "../../types";

const buildCriterion = (overrides?: Partial<KanbanTask["acceptanceCriteria"][number]>) => ({
  id: "criterion-1",
  text: "Criterion",
  status: "pending" as const,
  ...overrides
});

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
  acceptanceCriteria: [
    buildCriterion({ id: "criterion-one", text: "One", status: "done" }),
    buildCriterion({ id: "criterion-two", text: "Two", status: "pending" })
  ],
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
        isLoading={false}
        isSaving={false}
        onRefresh={vi.fn()}
        onCreateTask={onCreateTask}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Create new task" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Prepare queue" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    expect(onCreateTask).toHaveBeenCalledWith({
      projectSlug: "alpha",
      title: "Prepare queue",
      description: "",
      status: "backlog",
      priority: "medium",
      acceptanceCriteria: []
    });
  });

  it("persists the drafted criterion when creating a new task without clicking add first", () => {
    /* Board-level create flow should not drop the last typed criterion when the user submits right away. */
    const onCreateTask = vi.fn();

    render(
      <KanbanBoard
        scope="project"
        tasks={[]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onRefresh={vi.fn()}
        onCreateTask={onCreateTask}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Create new task" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Prepare queue" } });
    fireEvent.change(screen.getByLabelText("Acceptance criterion"), {
      target: { value: "Queue entry has clear scope" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    expect(onCreateTask).toHaveBeenCalledWith({
      projectSlug: "alpha",
      title: "Prepare queue",
      description: "",
      status: "backlog",
      priority: "medium",
      acceptanceCriteria: [{ id: expect.any(String), text: "Queue entry has clear scope", status: "pending" }]
    });
  });

  it("renders all workflow columns including agent execution states", () => {
    /* Human and agent users need one board that separates raw ideas, refinement, readiness, queueing, and execution. */
    render(
      <KanbanBoard
        scope="project"
        tasks={[buildTask()]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onRefresh={vi.fn()}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    expect(screen.getByText("Backlog")).toBeTruthy();
    expect(screen.getByText("Refinement")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Queue")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("Discuss backlog item")).toBeTruthy();
    expect(screen.getByTitle("One").className).toContain("kanban-card-progress-segment-done");
    expect(screen.getByTitle("One").className).toContain("kanban-card-progress-segment-done-backlog");
    expect(screen.getByTitle("Two").className).toBe("kanban-card-progress-segment");
  });

  it("opens task editor by clicking the whole card and hides the legacy Edit button", () => {
    /* Editing should feel direct on touch devices, so the entire card acts as the edit trigger. */
    render(
      <KanbanBoard
        scope="project"
        tasks={[buildTask()]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onRefresh={vi.fn()}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Open task Discuss backlog item/i }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByDisplayValue("Discuss backlog item")).toBeTruthy();
  });

  it("renders criterion progress segments with per-status neon classes", () => {
    /* Dense cards should expose criterion health at a glance, so each segment gets a status-specific color channel. */
    const neonTask: KanbanTask = {
      ...buildTask(),
      id: "task-neon",
      title: "Criterion neon card",
      acceptanceCriteria: [
        buildCriterion({ id: "criterion-pending", status: "pending", text: "Criterion pending" }),
        buildCriterion({ id: "criterion-done", status: "done", text: "Criterion done" }),
        buildCriterion({ id: "criterion-blocked", status: "blocked", text: "Criterion blocked" })
      ]
    };

    render(
      <KanbanBoard
        scope="project"
        tasks={[neonTask]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onRefresh={vi.fn()}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    expect(screen.getByTitle("Criterion pending").className).toBe("kanban-card-progress-segment");
    expect(screen.getByTitle("Criterion blocked").className).toContain("kanban-card-progress-segment-blocked");
    expect(screen.getByTitle("Criterion done").className).toContain("kanban-card-progress-segment-done");
    expect(screen.getByTitle("Criterion done").className).toContain("kanban-card-progress-segment-done-backlog");
  });
});
