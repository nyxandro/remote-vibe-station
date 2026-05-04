/**
 * @fileoverview UI contract tests for ProjectsTab actions.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        statusMap={{}}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
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
        statusMap={{}}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={onSelectProject}
        onCreateProjectFolder={vi.fn()}
        onCloneRepository={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("tvoc"));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(onSelectProject).toHaveBeenCalledWith("tvoc");
    expect(screen.queryByRole("button", { name: "Deploy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop deploy" })).toBeNull();
  });

  it("hides manual sync/filter controls from toolbar", () => {
    /* Projects toolbar should keep only search after UX simplification. */
    render(
      <ProjectsTab
        visibleProjects={[buildProject()]}
        activeId={null}
        query=""
        statusMap={{}}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
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
        statusMap={{
          tvoc: [
            { name: "tvoc-backend-1", service: "backend", state: "running" },
            { name: "tvoc-miniapp-1", service: "miniapp", state: "exited" }
          ]
        }}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
        onCreateProjectFolder={vi.fn()}
        onCloneRepository={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Containers 1/2")).toBeTruthy();
  });

  it("renders git delta summary when backend provides it", () => {
    /* Project cards should display the current branch together with uncommitted lines/files counters. */
    render(
      <ProjectsTab
        visibleProjects={[buildProject()]}
        activeId={null}
        query=""
        statusMap={{}}
        gitSummaryMap={{ tvoc: { additions: 12, deletions: 5, filesChanged: 3, currentBranch: "feature/ui-branch" } }}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
        onCreateProjectFolder={vi.fn()}
        onCloneRepository={vi.fn()}
      />
    );

    expect(screen.getByText("feature/ui-branch")).toBeTruthy();
    expect(screen.getByText("+12")).toBeTruthy();
    expect(screen.getByText("-5")).toBeTruthy();
    expect(screen.getByText("3 files")).toBeTruthy();
  });

  it("renders current branch for clean repositories too", () => {
    /* Even without local changes the compact git row should stay visible so operators can confirm the active branch at a glance. */
    render(
      <ProjectsTab
        visibleProjects={[buildProject()]}
        activeId={null}
        query=""
        statusMap={{}}
        gitSummaryMap={{ tvoc: { additions: 0, deletions: 0, filesChanged: 0, currentBranch: "main" } }}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
        onCreateProjectFolder={vi.fn()}
        onCloneRepository={vi.fn()}
      />
    );

    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("+0")).toBeTruthy();
    expect(screen.getByText("-0")).toBeTruthy();
    expect(screen.getByText("0 files")).toBeTruthy();
  });

  it("supports create and clone project actions from one add-project modal", async () => {
    /* Project creation should stay inside one centered modal instead of expanding inline panels under the toolbar. */
    const onCreateProjectFolder = vi.fn();
    const onCloneRepository = vi.fn();
    render(
      <ProjectsTab
        visibleProjects={[buildProject()]}
        activeId={null}
        query=""
        statusMap={{}}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
        onCreateProjectFolder={onCreateProjectFolder}
        onCloneRepository={onCloneRepository}
      />
    );

    fireEvent.click(screen.getByLabelText("Create project"));
    expect(screen.getByRole("dialog", { name: "Add project" })).toBeTruthy();
    expect(screen.queryByText("PROJECTS")).toBeNull();
    expect(screen.getByRole("tab", { name: "Local" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Git" }).getAttribute("aria-selected")).toBe("false");

    fireEvent.change(screen.getByPlaceholderText("project-name"), { target: { value: "new-project" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project folder" }));
    await waitFor(() => {
      expect(onCreateProjectFolder).toHaveBeenCalledWith("new-project");
      expect(screen.queryByRole("dialog", { name: "Add project" })).toBeNull();
    });

    fireEvent.click(screen.getByLabelText("Create project"));
    expect(screen.getByRole("dialog", { name: "Add project" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Git" }));
    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/repo.git"), {
      target: { value: "https://github.com/acme/repo.git" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Clone repository now" }));
    await waitFor(() => {
      expect(onCloneRepository).toHaveBeenCalledWith("https://github.com/acme/repo.git", undefined);
      expect(screen.queryByRole("dialog", { name: "Add project" })).toBeNull();
    });
  });

  it("closes the add-project modal from the top-right close control without mutating projects", async () => {
    /* One explicit close affordance in the modal header is enough; footer should stay focused on the primary action only. */
    const onCreateProjectFolder = vi.fn();
    const onCloneRepository = vi.fn();

    render(
      <ProjectsTab
        visibleProjects={[buildProject()]}
        activeId={null}
        query=""
        statusMap={{}}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
        onCreateProjectFolder={onCreateProjectFolder}
        onCloneRepository={onCloneRepository}
      />
    );

    fireEvent.click(screen.getByLabelText("Create project"));
    expect(screen.getByRole("dialog", { name: "Add project" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel add project" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Local" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Git" }).getAttribute("aria-selected")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Close add project" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add project" })).toBeNull();
    });
    expect(onCreateProjectFolder).not.toHaveBeenCalled();
    expect(onCloneRepository).not.toHaveBeenCalled();
  });

  it("does not render deploy route links inside expanded project card", () => {
    /* Project cards must not expose the removed shared-server deploy mechanism. */
    const { container } = render(
      <ProjectsTab
        visibleProjects={[
          buildProject({
            status: "running"
          })
        ]}
        activeId="tvoc"
        query=""
        statusMap={{}}
        gitSummaryMap={{}}
        onQueryChange={vi.fn()}
        onSelectProject={vi.fn()}
        onCreateProjectFolder={vi.fn()}
        onCloneRepository={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("tvoc"));

    const expandedCard = container.querySelector(".project-card");
    const linksBlock = expandedCard?.querySelector(".project-deploy-links");
    const actionsBlock = expandedCard?.querySelector(".project-actions-footer");
    expect(linksBlock).toBeNull();
    expect(actionsBlock).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open / })).toBeNull();
  });
});
