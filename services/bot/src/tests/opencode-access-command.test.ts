/**
 * @fileoverview Tests for Telegram /access command that issues OpenCode magic links.
 *
 * Exports:
 * - (none)
 */

import { Telegraf } from "telegraf";

import { BotConfig } from "../config";
import { registerOpenCodeAccessCommand } from "../opencode-access-command";
import { OpenCodeWebAuthService } from "../opencode-web-auth";

describe("registerOpenCodeAccessCommand", () => {
  const config: BotConfig = {
    telegramBotToken: "token",
    adminIds: [1],
    backendUrl: "http://backend:3000",
    publicBaseUrl: "http://localhost:4173",
    opencodePublicBaseUrl: "https://code.example.com"
  };

  const createBotMock = (): {
    bot: Telegraf;
    getCommand: (name: string) => ((ctx: any) => Promise<void>) | undefined;
  } => {
    const commands = new Map<string, (ctx: any) => Promise<void>>();
    const botLike = {
      command: jest.fn((name: string, handler: (ctx: any) => Promise<void>) => {
        commands.set(name, handler);
      })
    };

    return {
      bot: botLike as unknown as Telegraf,
      getCommand: (name: string) => commands.get(name)
    };
  };

  it("returns one-time link for allowed admin", async () => {
    /* Admin gets a pre-signed exchange URL with explicit TTL guidance. */
    const webAuth = {
      issueMagicLink: jest.fn(async () => "magic-token"),
      getLinkTtlMs: jest.fn(() => 5 * 60 * 1000),
      getSessionTtlMs: jest.fn(() => 30 * 24 * 60 * 60 * 1000)
    } as unknown as OpenCodeWebAuthService;
    const mock = createBotMock();

    registerOpenCodeAccessCommand({
      bot: mock.bot,
      config,
      webAuth,
      isAdmin: (id) => id === 1
    });

    const handler = mock.getCommand("access");
    expect(handler).toBeDefined();

    const reply = jest.fn(async () => undefined);
    await handler!({ from: { id: 1 }, reply });

    expect(webAuth.issueMagicLink).toHaveBeenCalledWith({ adminId: 1 });
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("Ссылка одноразовая и живет 5 минут"),
      expect.objectContaining({
        parse_mode: "HTML",
        link_preview_options: {
          is_disabled: true
        }
      })
    );
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("https://code.example.com/opencode-auth/exchange?token=magic-token"),
      expect.anything()
    );
  });

  it("denies command for non-admin account", async () => {
    /* Unauthorized Telegram users must not receive valid auth links. */
    const webAuth = {
      issueMagicLink: jest.fn(async () => "magic-token"),
      getLinkTtlMs: jest.fn(() => 5 * 60 * 1000),
      getSessionTtlMs: jest.fn(() => 30 * 24 * 60 * 60 * 1000)
    } as unknown as OpenCodeWebAuthService;
    const mock = createBotMock();

    registerOpenCodeAccessCommand({
      bot: mock.bot,
      config,
      webAuth,
      isAdmin: () => false
    });

    const handler = mock.getCommand("access");
    expect(handler).toBeDefined();

    const reply = jest.fn(async () => undefined);
    await handler!({ from: { id: 42 }, reply });

    expect(webAuth.issueMagicLink).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith("Доступ запрещен");
  });
});
