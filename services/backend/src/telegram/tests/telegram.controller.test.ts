/**
 * @fileoverview Contract tests for TelegramController command catalog endpoint.
 *
 * Exports:
 * - (none)
 */

import { BadRequestException } from "@nestjs/common";
import { Request } from "express";

import { TelegramController } from "../telegram.controller";

const buildController = () => {
  /* Keep command catalog mock explicit because this endpoint is contract-critical. */
  const commandCatalog = {
    listForAdmin: jest.fn().mockResolvedValue({
      commands: [{ command: "start", description: "Запуск бота и справка" }],
      lookup: { start: "start", review_changes: "review-changes" }
    })
  };

  /* Other dependencies are irrelevant for listCommands path and must stay inert. */
  const store = {};
  const events = {};
  const prompts = {};
  const preferences = {
    getSettings: jest.fn().mockResolvedValue({
      selected: {
        model: { providerID: "opencode", modelID: "big-pickle" },
        thinking: null,
        agent: null
      }
    })
  };
  const projects = {
    getActiveProject: jest.fn().mockResolvedValue(null)
  };
  const gitSummary = {
    summaryForProjectRoot: jest.fn().mockResolvedValue(null)
  };
  const opencode = {
    listQuestions: jest.fn(),
    replyQuestion: jest.fn(),
    replyPermission: jest.fn()
  };
  const sessionRouting = {
    resolveQuestionToken: jest.fn(),
    resolveQuestion: jest.fn(),
    consumeQuestion: jest.fn(),
    resolvePermissionToken: jest.fn(),
    resolvePermission: jest.fn(),
    consumePermission: jest.fn(),
    bindSession: jest.fn(),
    resolveSessionToken: jest.fn(),
    consumeSessionToken: jest.fn()
  };
  const diffPreviews = {};
  const runtime = {
    checkVersionStatus: jest.fn().mockResolvedValue({
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      latestCheckedAt: "2026-02-24T12:00:00.000Z",
      updateAvailable: true
    })
  };

  const controller = new TelegramController(
    store as never,
    events as never,
    prompts as never,
    commandCatalog as never,
    preferences as never,
    projects as never,
    gitSummary as never,
    opencode as never,
    sessionRouting as never,
    diffPreviews as never,
    runtime as never
  );

  return { controller, commandCatalog, preferences, projects, gitSummary, opencode, sessionRouting, runtime };
};

describe("TelegramController.listCommands", () => {
  test("returns merged command catalog in stable API shape", async () => {
    /* Endpoint must forward both menu commands and alias lookup for bot sync. */
    const { controller, commandCatalog } = buildController();
    const req = { authAdminId: 649624756 } as unknown as Request;

    const result = await controller.listCommands(req);

    expect(commandCatalog.listForAdmin).toHaveBeenCalledWith(649624756);
    expect(result).toEqual({
      commands: [{ command: "start", description: "Запуск бота и справка" }],
      lookup: { start: "start", review_changes: "review-changes" }
    });
  });

  test("throws when admin identity is missing", async () => {
    /* Guarded endpoint still validates resolved admin id before service call. */
    const { controller, commandCatalog } = buildController();
    const req = {} as Request;

    await expect(controller.listCommands(req)).rejects.toThrow(BadRequestException);
    expect(commandCatalog.listForAdmin).not.toHaveBeenCalled();
  });
});

describe("TelegramController.getStartupSummary", () => {
  test("returns project git mode and commands for start message", async () => {
    /* Start summary must include all key blocks used by Telegram welcome message. */
    const { controller, projects, gitSummary, preferences, commandCatalog } = buildController();
    projects.getActiveProject.mockResolvedValue({
      slug: "remote-vibe-station",
      rootPath: "/home/nyx/projects/remote-vibe-station"
    });
    gitSummary.summaryForProjectRoot.mockResolvedValue({ filesChanged: 3, additions: 21, deletions: 8 });
    preferences.getSettings.mockResolvedValue({
      selected: {
        model: { providerID: "opencode", modelID: "gpt-5-nano" },
        thinking: "medium",
        agent: "build"
      }
    });
    commandCatalog.listForAdmin.mockResolvedValue({
      commands: [
        { command: "mode", description: "Настроить model/agent" },
        { command: "chat", description: "Включить стрим ответов" }
      ],
      lookup: { mode: "mode", chat: "chat" }
    });

    const result = await controller.getStartupSummary({ authAdminId: 649624756 } as unknown as Request);

    expect(projects.getActiveProject).toHaveBeenCalledWith(649624756);
    expect(gitSummary.summaryForProjectRoot).toHaveBeenCalledWith("/home/nyx/projects/remote-vibe-station");
    expect(result).toEqual({
      project: {
        slug: "remote-vibe-station",
        rootPath: "/home/nyx/projects/remote-vibe-station"
      },
      git: { filesChanged: 3, additions: 21, deletions: 8 },
      mode: {
        providerID: "opencode",
        modelID: "gpt-5-nano",
        thinking: "medium",
        agent: "build"
      },
      commands: [
        { command: "mode", description: "Настроить model/agent" },
        { command: "chat", description: "Включить стрим ответов" }
      ]
    });
  });

  test("throws when admin identity is missing", async () => {
    /* Endpoint is admin-only and must fail fast without identity. */
    const { controller } = buildController();

    await expect(controller.getStartupSummary({} as Request)).rejects.toThrow(BadRequestException);
  });
});

describe("TelegramController.replyPermission", () => {
  test("submits selected permission response for pending token", async () => {
    /* Callback token must be resolved to session/directory before forwarding to OpenCode. */
    const { controller, opencode, sessionRouting } = buildController();
    sessionRouting.resolvePermissionToken.mockReturnValue("session-1:perm-1");
    sessionRouting.resolvePermission.mockReturnValue({
      adminId: 649624756,
      sessionID: "session-1",
      directory: "/home/nyx/projects/remote-vibe-station",
      permissionID: "perm-1"
    });

    const result = await controller.replyPermission(
      { permissionToken: "abc123", response: "always" },
      { authAdminId: 649624756 } as unknown as Request
    );

    expect(opencode.replyPermission).toHaveBeenCalledWith({
      directory: "/home/nyx/projects/remote-vibe-station",
      sessionID: "session-1",
      permissionID: "perm-1",
      response: "always"
    });
    expect(sessionRouting.consumePermission).toHaveBeenCalledWith("session-1:perm-1");
    expect(result).toEqual({ ok: true, selected: "always" });
  });

  test("throws for unknown permission token", async () => {
    /* Missing/stale token should fail fast to avoid applying response to wrong session. */
    const { controller, opencode, sessionRouting } = buildController();
    sessionRouting.resolvePermissionToken.mockReturnValue(null);

    await expect(
      controller.replyPermission({ permissionToken: "missing", response: "once" }, { authAdminId: 649624756 } as any)
    ).rejects.toThrow(BadRequestException);
    expect(opencode.replyPermission).not.toHaveBeenCalled();
  });
});

describe("TelegramController.repair", () => {
  test("runs recovery for active admin project", async () => {
    /* /repair endpoint should return machine-readable recovery summary for bot response. */
    const { controller } = buildController();
    (controller as any).prompts = {
      repair: jest.fn().mockResolvedValue({
        projectSlug: "arena",
        directory: "/home/nyx/projects/arena",
        busyTimeoutMs: 45_000,
        scanned: 3,
        busy: 2,
        aborted: ["ses-1", "ses-2"]
      })
    };

    const result = await controller.repair({ authAdminId: 649624756 } as unknown as Request);

    expect((controller as any).prompts.repair).toHaveBeenCalledWith(649624756);
    expect(result).toEqual({
      ok: true,
      projectSlug: "arena",
      directory: "/home/nyx/projects/arena",
      busyTimeoutMs: 45_000,
      scanned: 3,
      busy: 2,
      aborted: ["ses-1", "ses-2"]
    });
  });
});

describe("TelegramController.checkOpenCodeVersion", () => {
  test("checks latest OpenCode version for bot startup flow", async () => {
    /* Bot uses admin-header route to refresh latest version cache on startup. */
    const { controller, runtime } = buildController();

    const result = await controller.checkOpenCodeVersion({ authAdminId: 649624756 } as unknown as Request);

    expect(runtime.checkVersionStatus).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      latestCheckedAt: "2026-02-24T12:00:00.000Z",
      updateAvailable: true
    });
  });

  test("throws when admin identity is missing", async () => {
    /* Route stays fail-fast even for startup background checks. */
    const { controller, runtime } = buildController();

    await expect(controller.checkOpenCodeVersion({} as Request)).rejects.toThrow(BadRequestException);
    expect(runtime.checkVersionStatus).not.toHaveBeenCalled();
  });
});
