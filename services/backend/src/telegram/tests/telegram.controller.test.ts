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
  const opencode = {};
  const sessionRouting = {};
  const diffPreviews = {};

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
    diffPreviews as never
  );

  return { controller, commandCatalog, preferences, projects, gitSummary };
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
