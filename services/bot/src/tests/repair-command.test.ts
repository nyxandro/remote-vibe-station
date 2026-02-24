/**
 * @fileoverview Tests for /repair Telegram command wiring.
 *
 * Exports:
 * - (none)
 */

import { Telegraf } from "telegraf";

import { BotConfig } from "../config";
import { registerRepairCommand } from "../repair-command";

describe("registerRepairCommand", () => {
  const config: BotConfig = {
    telegramBotToken: "token",
    adminIds: [1],
    backendUrl: "http://backend:3000",
    publicBaseUrl: "http://localhost:4173",
    opencodePublicBaseUrl: "http://localhost:4096"
  };

  const createBotMock = (): {
    bot: Telegraf;
    getHandler: () => ((ctx: any) => Promise<void>) | undefined;
  } => {
    let handler: ((ctx: any) => Promise<void>) | undefined;
    const botLike = {
      command: jest.fn((name: string, current: (ctx: any) => Promise<void>) => {
        if (name === "repair") {
          handler = current;
        }
      })
    };

    return {
      bot: botLike as unknown as Telegraf,
      getHandler: () => handler
    };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("calls backend repair endpoint and posts summary", async () => {
    /* Recovery result should be visible to admin in one concise Telegram message. */
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        projectSlug: "arena",
        directory: "/home/nyx/projects/arena",
        busyTimeoutMs: 45_000,
        scanned: 3,
        busy: 2,
        aborted: ["ses-1", "ses-2"]
      })
    } as Response);

    const mock = createBotMock();
    registerRepairCommand({ bot: mock.bot, config, isAdmin: (id: number | undefined) => id === 1 });
    const handler = mock.getHandler();
    expect(handler).toBeDefined();

    const reply = jest.fn(async () => undefined);
    await handler!({ from: { id: 1 }, reply });

    expect(fetchMock).toHaveBeenCalledWith("http://backend:3000/api/telegram/repair", expect.any(Object));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("/repair завершен"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("таймаут: 45с"));
  });
});
