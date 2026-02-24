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
    publicBaseUrl: "http://localhost:4173"
  };

  const createBotMock = (): {
    bot: Telegraf;
    getHandler: () => ((ctx: any) => Promise<void>) | undefined;
  } => {
    let handler: ((ctx: any) => Promise<void>) | undefined;
    const botLike = {
      on: jest.fn((event: string, current: (ctx: any) => Promise<void>) => {
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
    });

    expect(fetchMock).toHaveBeenCalledWith("http://backend:3000/api/telegram/permission/reply", expect.any(Object));
    expect(answerCbQuery).toHaveBeenCalledWith("Решение отправлено", undefined);
    expect(editMessageReplyMarkup).toHaveBeenCalledWith({ inline_keyboard: [] });
  });
});
