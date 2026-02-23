/**
 * @fileoverview Tests for OutboxWorker progress message replacement behavior.
 *
 * Exports/constructs:
 * - makeWorker (L20) - Builds worker with mocked config/bot.
 * - describe("OutboxWorker replace delivery", L35) - Covers edit fallback and error path.
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
});
