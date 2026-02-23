/**
 * @fileoverview HTTP-level contract tests for TelegramController commands endpoint.
 *
 * Exports:
 * - (none)
 */

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { ConfigToken } from "../../config/config.types";
import { EventsService } from "../../events/events.service";
import { OpenCodeClient } from "../../open-code/opencode-client";
import { OpenCodeSessionRoutingStore } from "../../open-code/opencode-session-routing.store";
import { PromptService } from "../../prompt/prompt.service";
import { ProjectGitService } from "../../projects/project-git.service";
import { ProjectsService } from "../../projects/projects.service";
import { AdminHeaderGuard } from "../../security/admin-header.guard";
import { TelegramDiffPreviewStore } from "../diff-preview/telegram-diff-preview.store";
import { TelegramController } from "../telegram.controller";
import { TelegramCommandCatalogService } from "../telegram-command-catalog.service";
import { TelegramOutboxStore } from "../outbox/telegram-outbox.store";
import { TelegramPreferencesService } from "../preferences/telegram-preferences.service";
import { TelegramStreamStore } from "../telegram-stream.store";

describe("TelegramController /api/telegram/commands (e2e)", () => {
  let app: INestApplication;
  let commandCatalog: { listForAdmin: jest.Mock };
  let projects: { getActiveProject: jest.Mock };
  let gitSummary: { summaryForProjectRoot: jest.Mock };
  let preferences: { getSettings: jest.Mock };

  beforeEach(async () => {
    /* Keep catalog output deterministic to validate serialized JSON contract. */
    commandCatalog = {
      listForAdmin: jest.fn().mockResolvedValue({
        commands: [{ command: "start", description: "Запуск бота и справка" }],
        lookup: { start: "start", review_changes: "review-changes" }
      })
    };
    projects = {
      getActiveProject: jest.fn().mockResolvedValue({
        slug: "remote-vibe-station",
        rootPath: "/home/nyx/projects/remote-vibe-station"
      })
    };
    gitSummary = {
      summaryForProjectRoot: jest.fn().mockResolvedValue({ filesChanged: 2, additions: 5, deletions: 1 })
    };
    preferences = {
      getSettings: jest.fn().mockResolvedValue({
        selected: {
          model: { providerID: "opencode", modelID: "big-pickle" },
          thinking: null,
          agent: null
        }
      })
    };

    /* Build a minimal HTTP app with real routing/guards and mocked domain services. */
    const moduleRef = await Test.createTestingModule({
      controllers: [TelegramController],
      providers: [
        AdminHeaderGuard,
        {
          provide: ConfigToken,
          useValue: {
            adminIds: [649624756]
          }
        },
        { provide: TelegramStreamStore, useValue: {} },
        { provide: EventsService, useValue: {} },
        { provide: PromptService, useValue: {} },
        { provide: TelegramCommandCatalogService, useValue: commandCatalog },
        { provide: TelegramPreferencesService, useValue: preferences },
        { provide: ProjectsService, useValue: projects },
        { provide: ProjectGitService, useValue: gitSummary },
        { provide: OpenCodeClient, useValue: {} },
        { provide: OpenCodeSessionRoutingStore, useValue: {} },
        { provide: TelegramDiffPreviewStore, useValue: {} },
        { provide: TelegramOutboxStore, useValue: {} }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
  });

  afterEach(async () => {
    /* Always close listeners to avoid leaking ports between tests. */
    await app.close();
  });

  test("returns merged command catalog JSON for valid admin header", async () => {
    /* Endpoint contract must include both commands and lookup map for bot sync. */
    const response = await fetch(`${await app.getUrl()}/api/telegram/commands`, {
      headers: { "x-admin-id": "649624756" }
    });

    expect(response.status).toBe(200);
    expect(commandCatalog.listForAdmin).toHaveBeenCalledWith(649624756);

    const body = (await response.json()) as {
      commands: Array<{ command: string; description: string }>;
      lookup: Record<string, string>;
    };
    expect(body).toEqual({
      commands: [{ command: "start", description: "Запуск бота и справка" }],
      lookup: { start: "start", review_changes: "review-changes" }
    });
  });

  test("returns 401 when x-admin-id header is missing", async () => {
    /* Missing admin header must be rejected by AdminHeaderGuard before controller logic. */
    const response = await fetch(`${await app.getUrl()}/api/telegram/commands`);

    expect(response.status).toBe(401);
    expect(commandCatalog.listForAdmin).not.toHaveBeenCalled();
  });

  test("returns 401 when x-admin-id is not in configured ADMIN_IDS", async () => {
    /* Guard must reject unknown admins so command catalog cannot leak across tenants. */
    const response = await fetch(`${await app.getUrl()}/api/telegram/commands`, {
      headers: { "x-admin-id": "111" }
    });

    expect(response.status).toBe(401);
    expect(commandCatalog.listForAdmin).not.toHaveBeenCalled();
  });

  test("returns startup summary JSON for valid admin header", async () => {
    /* Startup summary must provide project, git, mode and command blocks. */
    const response = await fetch(`${await app.getUrl()}/api/telegram/startup-summary`, {
      headers: { "x-admin-id": "649624756" }
    });

    expect(response.status).toBe(200);
    expect(projects.getActiveProject).toHaveBeenCalledWith(649624756);
    expect(gitSummary.summaryForProjectRoot).toHaveBeenCalledWith("/home/nyx/projects/remote-vibe-station");

    const body = (await response.json()) as {
      project: { slug: string; rootPath: string };
      git: { filesChanged: number; additions: number; deletions: number } | null;
      mode: { providerID: string; modelID: string; thinking: string | null; agent: string | null };
      commands: Array<{ command: string; description: string }>;
    };

    expect(body).toEqual({
      project: {
        slug: "remote-vibe-station",
        rootPath: "/home/nyx/projects/remote-vibe-station"
      },
      git: { filesChanged: 2, additions: 5, deletions: 1 },
      mode: {
        providerID: "opencode",
        modelID: "big-pickle",
        thinking: null,
        agent: null
      },
      commands: [{ command: "start", description: "Запуск бота и справка" }]
    });
  });
});
