/**
 * @fileoverview Tests for structured ProjectsController validation errors.
 */

import { BadRequestException } from "@nestjs/common";

import { ProjectsController } from "../projects.controller";

const createController = () => {
  /* Build controller with minimal collaborators because these tests focus on validation errors only. */
  const projects = {
    registerProject: jest.fn(),
    sendTerminalInput: jest.fn(),
    getProjectRootPath: jest.fn()
  } as any;
  const gitSummaryService = {} as any;
  const gitOps = {} as any;
  const deployment = {} as any;
  const workspace = {} as any;
  const events = {} as any;

  return new ProjectsController(projects, gitSummaryService, gitOps, deployment, workspace, events);
};

describe("ProjectsController structured errors", () => {
  it("returns structured payload for invalid project registration", async () => {
    /* Project registration should fail with stable metadata instead of plain string validation text. */
    const controller = createController();

    await expect(controller.register({} as any)).rejects.toThrow(BadRequestException);

    try {
      await controller.register({} as any);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "APP_PROJECT_PAYLOAD_INVALID",
        message: "Project payload is invalid.",
        hint: "Provide project name, slug, root path, compose path, service name and service port."
      });
    }
  });

  it("returns structured payload for missing terminal input", async () => {
    /* Terminal endpoint should not accept malformed requests without explicit input text. */
    const controller = createController();

    await expect(controller.terminal("arena", {} as any)).rejects.toThrow(BadRequestException);

    try {
      await controller.terminal("arena", {} as any);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "APP_PROJECT_TERMINAL_INPUT_REQUIRED",
        message: "Terminal input is required.",
        hint: "Provide non-empty terminal input text and retry the request."
      });
    }
  });

  it("returns structured payload for missing commit message", async () => {
    /* Git commit endpoint should fail fast before touching repository state when message is blank. */
    const controller = createController();

    await expect(controller.gitCommit("arena", { message: "   " })).rejects.toThrow(BadRequestException);

    try {
      await controller.gitCommit("arena", { message: "   " });
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "APP_PROJECT_GIT_COMMIT_MESSAGE_REQUIRED",
        message: "Commit message is required.",
        hint: "Provide a non-empty commit message and retry the commit request."
      });
    }
  });
});
