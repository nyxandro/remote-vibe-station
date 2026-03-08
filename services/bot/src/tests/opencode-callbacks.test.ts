/**
 * @fileoverview Tests for OpenCode callback handlers in Telegram bot.
 *
 * Exports:
 * - (none)
 */

import { Telegraf } from "telegraf";

import { BotConfig } from "../config";
import { registerOpenCodeCallbacks } from "../opencode-callbacks";

describe("registerOpenCodeCallbacks", () => {
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
    getHandler: () => ((ctx: any, next?: () => Promise<void>) => Promise<void>) | undefined;
  } => {
    let handler: ((ctx: any, next?: () => Promise<void>) => Promise<void>) | undefined;
    const botLike = {
      on: jest.fn((event: string, current: (ctx: any, next?: () => Promise<void>) => Promise<void>) => {
        if (event === "callback_query") {
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

  it("routes permission callback to backend permission/reply endpoint", async () => {
    /* Permission approvals must be forwarded with selected response enum. */
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({ selected: "once" })
    } as Response);

    const mock = createBotMock();
    registerOpenCodeCallbacks({ bot: mock.bot, config, isAdmin: (id: number | undefined) => id === 1 });
    const handler = mock.getHandler();
    expect(handler).toBeDefined();

    const answerCbQuery = jest.fn(async () => undefined);
    const editMessageReplyMarkup = jest.fn(async () => undefined);
    await handler!({
      callbackQuery: { data: "perm|token123|once" },
      from: { id: 1 },
      answerCbQuery,
      editMessageReplyMarkup,
      reply: jest.fn(async () => undefined)
    }, async () => undefined);

    expect(fetchMock).toHaveBeenCalledWith("http://backend:3000/api/telegram/permission/reply", expect.any(Object));
    expect(answerCbQuery).toHaveBeenCalledWith("Решение отправлено", undefined);
    expect(editMessageReplyMarkup).toHaveBeenCalledWith({ inline_keyboard: [] });
  });

  it("updates the same Telegram message when OpenCode has the next question step", async () => {
    /* Multi-question flows should reuse one prompt message instead of posting noisy confirmations between steps. */
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        selected: "Да",
        completed: false,
        nextPrompt: {
          text: "OpenCode спрашивает (2/2):\nScope\nВторой вопрос?",
          questionIndex: 1,
          options: ["API", "UI"]
        }
      })
    } as Response);

    const mock = createBotMock();
    registerOpenCodeCallbacks({ bot: mock.bot, config, isAdmin: (id: number | undefined) => id === 1 });
    const handler = mock.getHandler();
    expect(handler).toBeDefined();

    const answerCbQuery = jest.fn(async () => undefined);
    const editMessageText = jest.fn(async () => undefined);
    const editMessageReplyMarkup = jest.fn(async () => undefined);
    const reply = jest.fn(async () => undefined);
    await handler!(
      {
        callbackQuery: { data: "q|token123|0" },
        from: { id: 1 },
        answerCbQuery,
        editMessageText,
        editMessageReplyMarkup,
        reply
      },
      async () => undefined
    );

    expect(fetchMock).toHaveBeenCalledWith("http://backend:3000/api/telegram/question/reply", expect.any(Object));
    expect(answerCbQuery).toHaveBeenCalledWith("Ответ принят", undefined);
    expect(editMessageText).toHaveBeenCalledWith(
      "OpenCode спрашивает (2/2):\nScope\nВторой вопрос?",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "API", callback_data: "q|token123|1|0" }],
            [{ text: "UI", callback_data: "q|token123|1|1" }]
          ]
        }
      }
    );
    expect(editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("rejects malformed question callback payloads with empty indexes", async () => {
    /* Empty callback segments must not be coerced into zero because that can answer the wrong question step. */
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({ ok: true } as Response);

    const mock = createBotMock();
    registerOpenCodeCallbacks({ bot: mock.bot, config, isAdmin: (id: number | undefined) => id === 1 });
    const handler = mock.getHandler();
    expect(handler).toBeDefined();

    const answerCbQuery = jest.fn(async () => undefined);
    await handler!(
      {
        callbackQuery: { data: "q|token123||1" },
        from: { id: 1 },
        answerCbQuery,
        editMessageText: jest.fn(async () => undefined),
        editMessageReplyMarkup: jest.fn(async () => undefined),
        reply: jest.fn(async () => undefined)
      },
      async () => undefined
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(answerCbQuery).toHaveBeenCalledWith("Некорректный ответ", { show_alert: true });
  });

  it("delegates non-opencode callbacks to next handler", async () => {
    /* Session picker callbacks must pass through this middleware untouched. */
    const mock = createBotMock();
    registerOpenCodeCallbacks({ bot: mock.bot, config, isAdmin: (id: number | undefined) => id === 1 });
    const handler = mock.getHandler();
    expect(handler).toBeDefined();

    const next = jest.fn(async () => undefined);
    await handler!(
      {
        callbackQuery: { data: "sess|token-1" },
        from: { id: 1 },
        answerCbQuery: jest.fn(async () => undefined),
        editMessageReplyMarkup: jest.fn(async () => undefined),
        reply: jest.fn(async () => undefined)
      },
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });
});
