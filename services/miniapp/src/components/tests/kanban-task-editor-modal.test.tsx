/**
 * @fileoverview UI contract tests for checklist-style kanban acceptance criteria editing.
 *
 * Exports:
 * - none (Vitest suite).
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KanbanTaskEditorModal } from "../KanbanTaskEditorModal";
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
  projectName: "Alpha",
  title: "Prepare release",
  description: "Finalize the project before shipping.",
  status: "backlog",
  priority: "medium",
  acceptanceCriteria: ["Docs updated", "Smoke test passes"],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-10T09:00:00.000Z",
  updatedAt: "2026-03-10T09:00:00.000Z",
  claimedBy: null,
  leaseUntil: null,
  ...overrides
});

describe("KanbanTaskEditorModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("builds acceptance criteria through explicit checklist items before submit", () => {
    /* Create flow should add each acceptance criterion as a separate visible checklist item. */
    const onSubmit = vi.fn();

    render(
      <KanbanTaskEditorModal
        mode="create"
        scope="project"
        activeProjectSlug="alpha"
        projects={[buildProject()]}
        isSaving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Prepare release" } });

    fireEvent.change(screen.getByLabelText("Acceptance criterion"), {
      target: { value: "Docs updated" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));

    fireEvent.change(screen.getByLabelText("Acceptance criterion"), {
      target: { value: "Smoke test passes" }
    });
    fireEvent.keyDown(screen.getByLabelText("Acceptance criterion"), {
      key: "Enter",
      code: "Enter"
    });

    expect(screen.getByText("Docs updated")).toBeTruthy();
    expect(screen.getByText("Smoke test passes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    expect(onSubmit).toHaveBeenCalledWith({
      projectSlug: "alpha",
      title: "Prepare release",
      description: "",
      status: "backlog",
      priority: "medium",
      acceptanceCriteria: ["Docs updated", "Smoke test passes"],
      resultSummary: null,
      blockedReason: null
    });
  });

  it("renders existing criteria as separate items and allows removing one", () => {
    /* Edit flow should expose persisted criteria as individual checklist rows instead of textarea lines. */
    const onSubmit = vi.fn();

    render(
      <KanbanTaskEditorModal
        mode="edit"
        scope="project"
        activeProjectSlug="alpha"
        projects={[buildProject()]}
        task={buildTask()}
        isSaving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText("Docs updated")).toBeTruthy();
    expect(screen.getByText("Smoke test passes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove criterion Docs updated" }));
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));

    expect(onSubmit).toHaveBeenCalledWith({
      projectSlug: "alpha",
      title: "Prepare release",
      description: "Finalize the project before shipping.",
      status: "backlog",
      priority: "medium",
      acceptanceCriteria: ["Smoke test passes"],
      resultSummary: null,
      blockedReason: null
    });
  });
});
