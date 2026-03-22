/**
 * @fileoverview Tests for Telegram outbox controller delivery events.
 *
 * Exports:
 * - none (Jest suite).
 */

import { TelegramOutboxController } from "../telegram-outbox.controller";

describe("TelegramOutboxController", () => {
  test("publishes telegram.outbox.delivered only for final reply delivery groups", () => {
    /* Handoff barrier should advance only from final assistant reply receipts, not from unrelated outbox items. */
    const store = {
      report: jest.fn(() => [
        {
          id: "item-1",
          adminId: 7,
          deliveryGroupId: "group-1",
          deliveredAt: "2026-03-22T12:00:00.000Z",
          telegramMessageId: 101
        },
        {
          id: "item-2",
          adminId: 7,
          deliveryGroupId: undefined,
          deliveredAt: "2026-03-22T12:00:01.000Z",
          telegramMessageId: 102
        }
      ]),
      pruneDelivered: jest.fn()
    };
    const events = {
      publish: jest.fn()
    };
    const controller = new TelegramOutboxController(store as never, events as never);

    const result = controller.report(
      {
        authAdminId: 7,
        headers: { "x-bot-worker-id": "worker-1" }
      } as never,
      {
        results: [{ id: "item-1", ok: true }]
      }
    );

    expect(result).toEqual({ ok: true });
    expect(events.publish).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "telegram.outbox.delivered",
        data: expect.objectContaining({
          adminId: 7,
          itemId: "item-1",
          deliveryGroupId: "group-1",
          telegramMessageId: 101
        })
      })
    );
    expect(store.pruneDelivered).toHaveBeenCalled();
  });
});
