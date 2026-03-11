/**
 * @fileoverview Tests for OutboxWorker replace delivery and report retries.
 *
 * Exports/constructs:
 * - makeWorker - Builds worker with mocked config/bot.
 * - describe("OutboxWorker replace delivery", ...) - Covers replace/edit fallback paths.
 */

import { OutboxWorker } from "../outbox-worker";

type TelegramMock = {
  sendMessage: jest.Mock;
  editMessageText: jest.Mock;
};

const makeWorker = (telegram: TelegramMock): OutboxWorker => {
  /* Keep constructor inputs minimal: tests call private deliver directly. */
  const config = {
    telegramBotToken: "token",
    backendUrl: "http://backend:3000",
    botBackendAuthToken: "secret-token",
    adminIds: [1]
  } as any;
  const bot = { telegram } as any;
  return new OutboxWorker(config, bot);
};

const makeReplaceItem = () => ({
  id: "item-1",
  chatId: 100,
  text: "updated",
  parseMode: "HTML" as const,
  disableNotification: true,
  mode: "replace" as const,
  progressKey: "bash:1:ses:call"
});

describe("OutboxWorker replace delivery", () => {
  it("sends replace-progress without reply keyboard by default", async () => {
    /* Progress messages must stay editable, so they should not include reply keyboard markup. */
    const telegram: TelegramMock = {
      editMessageText: jest.fn(async () => true),
      sendMessage: jest.fn(async () => ({ message_id: 701 }))
    };
    const worker = makeWorker(telegram);

    const result = await (worker as any).deliver(makeReplaceItem());

    expect(result).toEqual({ id: "item-1", ok: true, telegramMessageId: 701 });
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0][2]).toMatchObject({
      parse_mode: "HTML",
      disable_notification: true
    });
    expect(telegram.sendMessage.mock.calls[0][2].reply_markup).toBeUndefined();
  });

  it("falls back to sendMessage when Telegram rejects edit", async () => {
    /* Simulate Telegram 'message can't be edited' on update attempt. */
    const telegram: TelegramMock = {
      editMessageText: jest.fn(async () => {
        throw new Error("400: Bad Request: message can't be edited");
      }),
      sendMessage: jest.fn(async () => ({ message_id: 777 }))
    };
    const worker = makeWorker(telegram);

    /* Seed existing progress mapping to force edit path first. */
    (worker as any).progressMessageByKey.set("bash:1:ses:call", {
      chatId: 100,
      messageId: 555,
      text: "old",
      updatedAtMs: Date.now()
    });

    const result = await (worker as any).deliver(makeReplaceItem());

    /* Delivery must succeed and map should rebind to the new message id. */
    expect(result).toEqual({ id: "item-1", ok: true, telegramMessageId: 777 });
    expect(telegram.editMessageText).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect((worker as any).progressMessageByKey.get("bash:1:ses:call").messageId).toBe(777);
  });

  it("returns failure for edit errors unrelated to editability", async () => {
    /* Non-recoverable edit failures should not be swallowed. */
    const telegram: TelegramMock = {
      editMessageText: jest.fn(async () => {
        throw new Error("400: Bad Request: chat not found");
      }),
      sendMessage: jest.fn(async () => ({ message_id: 888 }))
    };
    const worker = makeWorker(telegram);

    (worker as any).progressMessageByKey.set("bash:1:ses:call", {
      chatId: 100,
      messageId: 556,
      text: "old",
      updatedAtMs: Date.now()
    });

    const result = await (worker as any).deliver(makeReplaceItem());

    /* Worker should report failure and avoid fallback send for wrong chat. */
    expect(result.ok).toBe(false);
    expect(result.error).toContain("chat not found");
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("reuses cached successful delivery for the same outbox item id", async () => {
    /* Re-pulled items after a failed report must not send a second Telegram message. */
    const telegram: TelegramMock = {
      editMessageText: jest.fn(),
      sendMessage: jest.fn(async () => ({ message_id: 909 }))
    };
    const worker = makeWorker(telegram);

    const firstResult = await (worker as any).deliver({
      id: "send-item-1",
      chatId: 100,
      text: "Команда завершена",
      disableNotification: true
    });
    const secondResult = await (worker as any).deliver({
      id: "send-item-1",
      chatId: 100,
      text: "Команда завершена",
      disableNotification: true
    });

    expect(firstResult).toEqual({ id: "send-item-1", ok: true, telegramMessageId: 909 });
    expect(secondResult).toEqual({ id: "send-item-1", ok: true, telegramMessageId: 909 });
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("retries pending report before pulling new items", async () => {
    /* Backend report failure must not cause the same Telegram message to be resent on the next poll. */
    const telegram: TelegramMock = {
      editMessageText: jest.fn(),
      sendMessage: jest.fn(async () => ({ message_id: 1001 }))
    };
    const worker = makeWorker(telegram);
    const fetchSpy = jest.spyOn(globalThis, "fetch" as any);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    let pullCalls = 0;

    fetchSpy.mockImplementation(async (...args: unknown[]) => {
      const url = String(args[0] ?? "");
      if (url.includes("/api/telegram/outbox/pull")) {
        pullCalls += 1;
        return {
          ok: true,
          json: async () => ({
            items:
              pullCalls === 1
                ? [
                    {
                      id: "send-item-2",
                      chatId: 100,
                      text: "Старое сообщение",
                      disableNotification: true
                    }
                  ]
                : []
          })
        } as Response;
      }

      if (url.includes("/api/admin/projects/active")) {
        return {
          ok: false,
          json: async () => ({})
        } as Response;
      }

      if (url.includes("/api/telegram/outbox/report")) {
        const callIndex = fetchSpy.mock.calls.filter(([candidate]) => String(candidate).includes("/api/telegram/outbox/report")).length;
        return {
          ok: callIndex > 1,
          status: callIndex > 1 ? 200 : 500,
          text: async () => "report failed"
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    try {
      await (worker as any).processAdmin(1);
      await (worker as any).processAdmin(1);

      expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("/api/telegram/outbox/report"))).toHaveLength(2);
    } finally {
      fetchSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
