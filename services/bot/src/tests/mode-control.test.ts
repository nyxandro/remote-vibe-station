/**
 * @fileoverview Tests for mode button label rendering.
 *
 * Exports:
 * - (none)
 */

import { Telegraf } from "telegraf";

import { BotConfig } from "../config";
import { MODE_BUTTON_TEXT, buildModeButtonText, registerModeControl } from "../mode-control";

describe("buildModeButtonText", () => {
  it("keeps default label when active project is absent", () => {
    expect(buildModeButtonText(null)).toBe(MODE_BUTTON_TEXT);
    expect(buildModeButtonText("   ")).toBe(MODE_BUTTON_TEXT);
  });

  it("renders active project suffix after separator", () => {
    expect(buildModeButtonText("aihub")).toBe("⚙️ Режим | aihub");
  });
});

describe("registerModeControl", () => {
  const config: BotConfig = {
    telegramBotToken: "token",
    adminIds: [1],
    backendUrl: "http://backend:3000",
    publicBaseUrl: "http://localhost:4173"
  };

  const createBotMock = (): {
    bot: Telegraf;
    getCallbackHandler: () => ((ctx: any, next: () => Promise<unknown>) => Promise<unknown>) | undefined;
  } => {
    /* Capture callback handler registered by mode control to test middleware routing. */
    let callbackHandler: ((ctx: any, next: () => Promise<unknown>) => Promise<unknown>) | undefined;
    const botLike = {
      command: jest.fn(),
      hears: jest.fn(),
      on: jest.fn((event: string, handler: (ctx: any, next: () => Promise<unknown>) => Promise<unknown>) => {
        if (event === "callback_query") {
          callbackHandler = handler;
        }
      })
    };

    return {
      bot: botLike as unknown as Telegraf,
      getCallbackHandler: () => callbackHandler
    };
  };

  it("passes non-mode callback queries to the next middleware", async () => {
    const mock = createBotMock();
    registerModeControl({
      bot: mock.bot,
      config,
      isAdmin: () => true
    });

    const handler = mock.getCallbackHandler();
    expect(handler).toBeDefined();

    const next = jest.fn(async () => undefined);
    await handler!({ callbackQuery: { data: "q|token|0" }, from: { id: 1 } }, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("handles mode callbacks itself and does not call next", async () => {
    const mock = createBotMock();
    registerModeControl({
      bot: mock.bot,
      config,
      isAdmin: () => false
    });

    const handler = mock.getCallbackHandler();
    expect(handler).toBeDefined();

    const next = jest.fn(async () => undefined);
    const answerCbQuery = jest.fn(async () => undefined);
    await handler!(
      {
        callbackQuery: { data: "mode|main" },
        from: { id: 999 },
        answerCbQuery
      },
      next
    );

    expect(answerCbQuery).toHaveBeenCalledWith("Access denied");
    expect(next).not.toHaveBeenCalled();
  });
});
