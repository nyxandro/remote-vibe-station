/**
 * @fileoverview Tests for project terminal controller snapshot and input routes.
 */

import { BadRequestException } from "@nestjs/common";

import { ProjectTerminalController } from "../project-terminal.controller";

describe("ProjectTerminalController", () => {
  const createController = () => {
    /* Keep controller collaborators minimal so tests stay focused on terminal route behavior. */
    const projects = {
      getProjectRootPath: jest.fn().mockReturnValue("/srv/projects/arena"),
      sendTerminalInput: jest.fn().mockResolvedValue(undefined)
    };
    const terminals = {
      ensure: jest.fn().mockResolvedValue(undefined),
      readSnapshot: jest.fn().mockReturnValue("user@host:/srv/projects/arena$ ")
    };

    return {
      controller: new ProjectTerminalController(projects as never, terminals as never),
      projects,
      terminals
    };
  };

  test("returns a buffered snapshot for the selected project terminal", async () => {
    /* Opening the terminal tab should hydrate the already-running PTY transcript before the first command is sent. */
    const { controller, projects, terminals } = createController();

    await expect(controller.snapshot("arena")).resolves.toEqual({ buffer: "user@host:/srv/projects/arena$ " });
    expect(projects.getProjectRootPath).toHaveBeenCalledWith("arena");
    expect(terminals.ensure).toHaveBeenCalledWith("arena", "/srv/projects/arena");
    expect(terminals.readSnapshot).toHaveBeenCalledWith("arena");
  });

  test("returns structured payload for missing terminal input", async () => {
    /* Terminal writes must still reject malformed requests before touching the PTY session. */
    const { controller } = createController();

    await expect(controller.sendInput("arena", {} as any)).rejects.toThrow(BadRequestException);

    try {
      await controller.sendInput("arena", {} as any);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "APP_PROJECT_TERMINAL_INPUT_REQUIRED",
        message: "Terminal input is required.",
        hint: "Provide non-empty terminal input text and retry the request."
      });
    }
  });
});
