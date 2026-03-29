/**
 * @fileoverview Tests for bot command sync runtime helpers.
 */

import { Telegraf } from "telegraf";

import { BotConfig } from "../config";
import { createCommandSyncRuntime } from "../bot-command-sync-runtime";

describe("createCommandSyncRuntime", () => {
  const config: BotConfig = {
    telegramBotToken: "token",
    adminIds: [1],
    backendUrl: "http://backend:3000",
    botBackendAuthToken: "secret-token",
    publicBaseUrl: "http://localhost:4173",
    opencodePublicBaseUrl: "http://localhost:4096"
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("syncs Telegram slash menu and stores normalized command lookup", async () => {
    /* Runtime should refresh both Telegram suggestions and local alias resolution in one fetch. */
    jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        commands: [{ command: "start", description: "Запуск" }],
        lookup: { review_changes: "review-changes" }
      })
    } as Response);

    const setMyCommands = jest.fn(async () => undefined);
    const botLike = {
      telegram: {
        setMyCommands
      }
    } as unknown as Telegraf;

    const runtime = createCommandSyncRuntime({ bot: botLike, config });
    await runtime.syncSlashCommands(1);

    expect(setMyCommands).toHaveBeenCalledWith([{ command: "start", description: "Запуск" }]);
    expect(runtime.resolveCommandAlias("review_changes")).toBe("review-changes");
    expect(runtime.resolveCommandAlias("missing")).toBeUndefined();
  });

  it("ignores active skill list while syncing Telegram slash commands", async () => {
    /* Skill metadata may come from the same backend response, but only menu commands should reach Telegram setMyCommands. */
    jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        commands: [{ command: "start", description: "Запуск" }],
        lookup: { pdf: "pdf" },
        skills: ["pdf"]
      })
    } as Response);

    const setMyCommands = jest.fn(async () => undefined);
    const botLike = {
      telegram: {
        setMyCommands
      }
    } as unknown as Telegraf;

    const runtime = createCommandSyncRuntime({ bot: botLike, config });
    await runtime.syncSlashCommands(1);

    expect(setMyCommands).toHaveBeenCalledWith([{ command: "start", description: "Запуск" }]);
    expect(runtime.resolveCommandAlias("pdf")).toBe("pdf");
  });
});
