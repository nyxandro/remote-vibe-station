/**
 * @fileoverview Tests for ProjectsController status endpoint behavior.
 */

import { ProjectsController } from "../projects.controller";

describe("ProjectsController status endpoint", () => {
  const createController = (statusImpl: (id: string) => Promise<unknown>) => {
    /* Build controller with mocked collaborators while focusing on status behavior only. */
    const projects: { statusProject: jest.Mock<Promise<unknown>, [string]> } = {
      statusProject: jest.fn(statusImpl)
    };
    const gitSummaryService = {} as any;
    const gitOps = {} as any;
    const deployment = {} as any;
    const workspace = {} as any;
    const events = {} as any;

    return {
      controller: new ProjectsController(projects as any, gitSummaryService, gitOps, deployment, workspace, events),
      projects
    };
  };

  test("returns empty list when project is not runnable", async () => {
    /*
     * Status polling should stay resilient for folders without compose files,
     * because users can keep such folders in workspace intentionally.
     */
    const { controller, projects } = createController(async () => {
      throw new Error("Project is not runnable (missing compose): nyxandro");
    });

    await expect(controller.status("nyxandro")).resolves.toEqual([]);
    expect(projects.statusProject).toHaveBeenCalledTimes(1);
    expect(projects.statusProject).toHaveBeenCalledWith("nyxandro");
  });

  test("returns empty list when project folder was removed", async () => {
    /*
     * Active selection can become stale after manual folder removal,
     * and UI polling must not degrade into repeated 400 errors.
     */
    const { controller, projects } = createController(async () => {
      throw new Error("Project folder not found: nyxandro");
    });

    await expect(controller.status("nyxandro")).resolves.toEqual([]);
    expect(projects.statusProject).toHaveBeenCalledTimes(1);
    expect(projects.statusProject).toHaveBeenCalledWith("nyxandro");
  });

  test("returns empty list for unexpected status failures", async () => {
    /*
     * Status endpoint is a telemetry/polling surface, so operational failures
     * should degrade to empty state instead of noisy 400 loops in UI.
     */
    const { controller, projects } = createController(async () => {
      throw new Error("Docker daemon timeout");
    });

    await expect(controller.status("arena")).resolves.toEqual([]);
    expect(projects.statusProject).toHaveBeenCalledTimes(1);
    expect(projects.statusProject).toHaveBeenCalledWith("arena");
  });

  test("returns upstream status payload when docker query succeeds", async () => {
    /* Successful status checks should pass through normalized payload unchanged. */
    const expected = [{ name: "arena-web-1", service: "web", state: "running", ports: [] }];
    const { controller, projects } = createController(async () => expected);

    await expect(controller.status("arena")).resolves.toEqual(expected);
    expect(projects.statusProject).toHaveBeenCalledTimes(1);
    expect(projects.statusProject).toHaveBeenCalledWith("arena");
  });
});
