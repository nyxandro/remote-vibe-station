/**
 * @fileoverview UI contract tests for kanban board interactions.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  projectName: "Alpha",
  ...overrides
});

describe("KanbanBoard", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
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

  it("restores the unfinished create draft after closing the modal and clears it after successful creation", async () => {
    /* Project drafts should survive accidental modal close, then reset once the task is really created. */
    const onCreateTask = vi.fn(async () => undefined);

    render(
      <KanbanBoard
        scope="project"
        tasks={[]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onCreateTask={onCreateTask}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Create new task" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Persist me" } });
    fireEvent.change(screen.getByLabelText("Acceptance criterion"), {
      target: { value: "Remember my progress" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Create new task" }));

    expect(screen.getByDisplayValue("Persist me")).toBeTruthy();
    expect(screen.getByDisplayValue("Remember my progress")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => {
      expect(onCreateTask).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Create new task" }));

    expect(screen.queryByDisplayValue("Persist me")).toBeNull();
    expect(screen.queryByDisplayValue("Remember my progress")).toBeNull();
  });

  it("renders all workflow columns including agent execution states", () => {
    /* Human and agent users need one board that separates raw ideas, planning, readiness, queueing, and execution. */
    render(
      <KanbanBoard
        scope="project"
        tasks={[buildTask()]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    expect(screen.getByText("Backlog")).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Queue")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("Discuss backlog item")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh board" })).toBeNull();
    expect(screen.getByTitle("One").className).toContain("kanban-card-progress-segment-done");
    expect(screen.getByTitle("One").className).toContain("kanban-card-progress-segment-done-backlog");
    expect(screen.getByTitle("Two").className).toBe("kanban-card-progress-segment");
  });

  it("shows the total execution time badge on completed cards", () => {
    /* Done cards should surface total active execution time directly on the board without reopening the task modal. */
    render(
      <KanbanBoard
        scope="project"
        tasks={[
          buildTask({
            id: "task-done",
            title: "Completed task",
            status: "done",
            statusTimeline: [
              { status: "queued", changedAt: "2026-03-10T09:00:00.000Z" },
              { status: "in_progress", changedAt: "2026-03-10T09:10:00.000Z" },
              { status: "blocked", changedAt: "2026-03-10T09:40:00.000Z" },
              { status: "queued", changedAt: "2026-03-10T10:00:00.000Z" },
              { status: "in_progress", changedAt: "2026-03-10T10:05:00.000Z" },
              { status: "done", changedAt: "2026-03-10T10:20:00.000Z" }
            ]
          })
        ]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Execution time 45m")).toBeTruthy();
  });

  it("starts on the first non-empty column when earlier columns are empty", async () => {
    /* Narrow mobile boards should land on the nearest useful column instead of an empty backlog shell. */
    const scrollTo = vi.fn();
    const { rerender } = render(
      <KanbanBoard
        scope="project"
        tasks={[]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    const board = document.querySelector(".kanban-columns") as HTMLDivElement;
    board.scrollTo = scrollTo;
    const planColumn = screen.getByText("Plan").closest("section") as HTMLElement;
    Object.defineProperty(planColumn, "offsetLeft", { configurable: true, value: 320 });

    rerender(
      <KanbanBoard
        scope="project"
        tasks={[buildTask({ id: "task-plan", status: "refinement", title: "Plan next task" })]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ left: 320, behavior: "smooth" });
    });
  });

  it("sorts cards in each column by updatedAt descending", () => {
    /* The freshest work should stay on top so the board reflects recent activity instead of initial creation order. */
    render(
      <KanbanBoard
        scope="project"
        tasks={[
          buildTask({ id: "task-older", title: "Older task", updatedAt: "2026-03-10T09:00:00.000Z" }),
          buildTask({ id: "task-newer", title: "Newer task", updatedAt: "2026-03-11T09:00:00.000Z" }),
          buildTask({ id: "task-middle", title: "Middle task", updatedAt: "2026-03-10T12:00:00.000Z" })
        ]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    expect(screen.getAllByText(/task$/).map((node) => node.textContent)).toEqual(["Newer task", "Middle task", "Older task"]);
  });

  it("shows only ten cards per column until the user loads more", () => {
    /* Long columns stay scannable by default, but operators can progressively reveal more cards when needed. */
    render(
      <KanbanBoard
        scope="project"
        tasks={Array.from({ length: 12 }, (_, index) =>
          buildTask({
            id: `task-${index + 1}`,
            title: `Task ${index + 1}`,
            updatedAt: `2026-03-${String(20 - index).padStart(2, "0")}T09:00:00.000Z`
          })
        )}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    expect(screen.getByText("Task 1")).toBeTruthy();
    expect(screen.getByText("Task 10")).toBeTruthy();
    expect(screen.queryByText("Task 11")).toBeNull();
    expect(screen.getByRole("button", { name: "ЗАГРУЗИТЬ ЕЩЕ" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "ЗАГРУЗИТЬ ЕЩЕ" }));

    expect(screen.getByText("Task 11")).toBeTruthy();
    expect(screen.getByText("Task 12")).toBeTruthy();
  });

  it("keeps cards visually minimal without blocked or result text snippets", () => {
    /* The compact card layout should surface only the essentials and avoid duplicating long terminal-state details. */
    render(
      <KanbanBoard
        scope="project"
        tasks={[
          buildTask({ blockedReason: "Waiting for API token", resultSummary: "Release shipped" })
        ]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onMoveTask={vi.fn()}
      />
    );

    expect(screen.queryByText(/Blocked:/)).toBeNull();
    expect(screen.queryByText(/Result:/)).toBeNull();
    expect(screen.queryByText(/Claimed:/)).toBeNull();
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

  it("sends an explicit checklist clear flag when edit mode removes every acceptance criterion", async () => {
    /* Once the app endpoint stops treating [] as delete, the board must mark intentional full clears explicitly. */
    const onUpdateTask = vi.fn(async () => undefined);

    render(
      <KanbanBoard
        scope="project"
        tasks={[buildTask()]}
        projects={[buildProject()]}
        activeProjectSlug="alpha"
        isLoading={false}
        isSaving={false}
        onCreateTask={vi.fn()}
        onUpdateTask={onUpdateTask}
        onMoveTask={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Open task Discuss backlog item/i }));
    fireEvent.click(screen.getAllByRole("button", { name: "Remove criterion" })[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove criterion" })[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));

    await waitFor(() => {
      expect(onUpdateTask).toHaveBeenCalledWith("task-1", {
        title: "Discuss backlog item",
        description: "Clarify acceptance criteria",
        status: "backlog",
        priority: "medium",
        acceptanceCriteria: [],
        clearAcceptanceCriteria: true,
        resultSummary: null,
        blockedReason: null
      });
    });
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
