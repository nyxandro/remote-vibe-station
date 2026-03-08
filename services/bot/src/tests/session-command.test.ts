/**
 * @fileoverview Tests for /new, /stop and /sessions Telegram command wiring.
 *
 * Exports:
 * - (none)
 */

import { Telegraf } from "telegraf";

import { BotConfig } from "../config";
import { registerSessionCommands } from "../session-command";

describe("registerSessionCommands", () => {
  const config: BotConfig = {
    telegramBotToken: "token",
    adminIds: [1],
    backendUrl: "http://backend:3000",
    botBackendAuthToken: "secret-token",
    publicBaseUrl: "http://localhost:4173",
    opencodePublicBaseUrl: "http://localhost:4096"
  };

  const createBotMock = (): {
    bot: Telegraf;
    getCommand: (name: string) => ((ctx: any) => Promise<void>) | undefined;
    getCallback: () => ((ctx: any) => Promise<void>) | undefined;
  } => {
    const commands = new Map<string, (ctx: any) => Promise<void>>();
    let callbackHandler: ((ctx: any) => Promise<void>) | undefined;
    const botLike = {
      command: jest.fn((name: string, handler: (ctx: any) => Promise<void>) => {
        commands.set(name, handler);
      }),
      on: jest.fn((event: string, handler: (ctx: any) => Promise<void>) => {
        if (event === "callback_query") {
          callbackHandler = handler;
        }
      })
    };

    return {
      bot: botLike as unknown as Telegraf,
      getCommand: (name: string) => commands.get(name),
      getCallback: () => callbackHandler
    };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("handles /new and posts generic started message without session id", async () => {
    /* User asked to avoid noisy/opaque ids and show only that new session started. */
    jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, projectSlug: "arena", sessionID: "session-new" })
    } as Response);

    const mock = createBotMock();
    registerSessionCommands({ bot: mock.bot, config, isAdmin: (id: number | undefined) => id === 1 });

    const handler = mock.getCommand("new");
    expect(handler).toBeDefined();

    const reply = jest.fn(async () => undefined);
    await handler!({ from: { id: 1 }, reply });

    expect(reply).toHaveBeenCalledWith("🆕 Начата новая сессия (проект: arena).");
  });

  it("handles /stop and confirms current request abort", async () => {
    /* Telegram must provide one local escape hatch to stop a mistaken or runaway prompt. */
    jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, projectSlug: "arena", sessionID: "session-new", aborted: true })
    } as Response);

    const mock = createBotMock();
    registerSessionCommands({ bot: mock.bot, config, isAdmin: (id: number | undefined) => id === 1 });

    const handler = mock.getCommand("stop");
    expect(handler).toBeDefined();

    const reply = jest.fn(async () => undefined);
    await handler!({ from: { id: 1 }, reply });

    expect(reply).toHaveBeenCalledWith("⏹ Остановил текущий запрос (проект: arena).");
  });

  it("handles /sessions and renders inline keyboard with titles", async () => {
    /* Session list should render as button menu with readable titles. */
    jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        projectSlug: "arena",
        sessions: [
          {
            title: "Fix bridge",
            status: "idle",
            updatedAt: "2026-02-24T11:22:33.000Z",
            active: true,
            sessionToken: "tok-1"
          }
        ]
      })
    } as Response);

    const mock = createBotMock();
    registerSessionCommands({ bot: mock.bot, config, isAdmin: (id: number | undefined) => id === 1 });

    const handler = mock.getCommand("sessions");
    expect(handler).toBeDefined();

    const reply = jest.fn(async () => undefined);
    await handler!({ from: { id: 1 }, reply });

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("Сессии проекта arena"),
      expect.objectContaining({
        reply_markup: expect.objectContaining({ inline_keyboard: expect.any(Array) })
      })
    );
  });

  it("handles session select callback and confirms switch", async () => {
    /* Callback flow should mirror permission UI and clear inline keyboard on success. */
    jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, projectSlug: "arena", sessionID: "session-archive" })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          sessions: [{ title: "Greeting in Russian conversation", active: true }]
        })
      } as Response);

    const mock = createBotMock();
    registerSessionCommands({ bot: mock.bot, config, isAdmin: (id: number | undefined) => id === 1 });
    const callback = mock.getCallback();
    expect(callback).toBeDefined();

    const answerCbQuery = jest.fn(async () => undefined);
    const editMessageReplyMarkup = jest.fn(async () => undefined);
    const reply = jest.fn(async () => undefined);

    await callback!({
      from: { id: 1 },
      callbackQuery: { data: "sess|tok-1" },
      answerCbQuery,
      editMessageReplyMarkup,
      reply
    });

    expect(answerCbQuery).toHaveBeenCalledWith("Переключаю сессию...");
    expect(editMessageReplyMarkup).toHaveBeenCalledWith({ inline_keyboard: [] });
    expect(reply).toHaveBeenCalledWith(
      "✅ Активная сессия переключена (проект: arena).\nТекущая сессия: Greeting in Russian conversation"
    );
  });
});
