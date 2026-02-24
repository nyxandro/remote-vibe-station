/**
 * @fileoverview UI contract tests for ProjectsTab actions.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectsTab } from "../ProjectsTab";
import { ProjectRecord } from "../../types";

const buildProject = (overrides?: Partial<ProjectRecord>): ProjectRecord => {
  /* Provide a minimal runnable project fixture for action rendering. */
  return {
    id: "tvoc",
    slug: "tvoc",
    name: "tvoc",
    rootPath: "/home/nyx/projects/tvoc",
    hasCompose: true,
    configured: false,
    runnable: true,
    status: "unknown",
    ...overrides
  };
};

describe("ProjectsTab", () => {
  afterEach(() => {
    /* Reset DOM between tests to keep role queries deterministic. */
    cleanup();
  });

  it("does not render legacy Status/Logs project actions", () => {
    /* Container status/logs controls now live in Containers tab only. */
    render(
      <ProjectsTab
        visibleProjects={[buildProject()]}
        activeId={null}
        query=""
        telegramStreamEnabled={false}
        statusMap={{}}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
        onDeployProject={vi.fn()}
        onStopProjectDeploy={vi.fn()}
        onCreateProjectFolder={vi.fn()}
        onCloneRepository={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Logs" })).toBeNull();
  });

  it("keeps only project selection action", () => {
    /* Docker lifecycle controls were moved to Containers tab. */
    const onSelectProject = vi.fn();
    render(
      <ProjectsTab
        visibleProjects={[buildProject()]}
        activeId={null}
        query=""
        telegramStreamEnabled={false}
        statusMap={{}}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={onSelectProject}
        onDeployProject={vi.fn()}
        onStopProjectDeploy={vi.fn()}
        onCreateProjectFolder={vi.fn()}
        onCloneRepository={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(onSelectProject).toHaveBeenCalledWith("tvoc");
    expect(screen.getByRole("button", { name: "Deploy" })).toBeTruthy();
  });

  it("hides manual sync/filter controls from toolbar", () => {
    /* Projects toolbar should keep only search after UX simplification. */
    render(
      <ProjectsTab
        visibleProjects={[buildProject()]}
        activeId={null}
        query=""
        telegramStreamEnabled={false}
        statusMap={{}}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
        onDeployProject={vi.fn()}
        onStopProjectDeploy={vi.fn()}
        onCreateProjectFolder={vi.fn()}
        onCloneRepository={vi.fn()}
      />
    );

    expect(screen.queryByText("Runnable only")).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sync OpenCode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Warm Recents" })).toBeNull();
  });

  it("renders running container count badge when status is known", () => {
    /* Project cards should show real compose health instead of Unknown placeholder. */
    render(
      <ProjectsTab
        visibleProjects={[buildProject()]}
        activeId={null}
        query=""
        telegramStreamEnabled={false}
        statusMap={{
          tvoc: [
            { name: "tvoc-backend-1", service: "backend", state: "running" },
            { name: "tvoc-miniapp-1", service: "miniapp", state: "exited" }
          ]
        }}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
        onDeployProject={vi.fn()}
        onStopProjectDeploy={vi.fn()}
        onCreateProjectFolder={vi.fn()}
        onCloneRepository={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Containers 1/2")).toBeTruthy();
  });

  it("renders git delta summary when backend provides it", () => {
    /* Project cards should display uncommitted lines/files counters. */
    render(
      <ProjectsTab
        visibleProjects={[buildProject()]}
        activeId={null}
        query=""
        telegramStreamEnabled={false}
        statusMap={{}}
        gitSummaryMap={{ tvoc: { additions: 12, deletions: 5, filesChanged: 3 } }}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
        onDeployProject={vi.fn()}
        onStopProjectDeploy={vi.fn()}
        onCreateProjectFolder={vi.fn()}
        onCloneRepository={vi.fn()}
      />
    );

    expect(screen.getByText("+12")).toBeTruthy();
    expect(screen.getByText("-5")).toBeTruthy();
    expect(screen.getByText("3 files")).toBeTruthy();
  });

  it("supports create/clone project actions from plus menu", () => {
    /* Toolbar should expose plus action with folder-create and git-clone flows. */
    const onCreateProjectFolder = vi.fn();
    const onCloneRepository = vi.fn();
    const onDeployProject = vi.fn();
    const onStopProjectDeploy = vi.fn();
    render(
      <ProjectsTab
        visibleProjects={[buildProject()]}
        activeId={null}
        query=""
        telegramStreamEnabled={false}
        statusMap={{}}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
        onDeployProject={onDeployProject}
        onStopProjectDeploy={onStopProjectDeploy}
        onCreateProjectFolder={onCreateProjectFolder}
        onCloneRepository={onCloneRepository}
      />
    );

    fireEvent.click(screen.getByLabelText("Create project"));
    fireEvent.click(screen.getByRole("button", { name: "Create project folder" }));
    fireEvent.change(screen.getByPlaceholderText("project-name"), { target: { value: "new-project" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onCreateProjectFolder).toHaveBeenCalledWith("new-project");

    fireEvent.click(screen.getByLabelText("Create project"));
    fireEvent.click(screen.getByRole("button", { name: "Clone git repository" }));
    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/repo.git"), {
      target: { value: "https://github.com/acme/repo.git" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Clone" }));
    expect(onCloneRepository).toHaveBeenCalledWith("https://github.com/acme/repo.git", undefined);

    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(onDeployProject).toHaveBeenCalledWith("tvoc");
    expect(onStopProjectDeploy).not.toHaveBeenCalled();
  });
});
