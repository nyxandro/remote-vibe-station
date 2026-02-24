/**
 * @fileoverview Tests for Telegram typing-based thinking indicator.
 *
 * Exports:
 * - (none)
 */

import { ThinkingIndicator } from "../thinking-indicator";

describe("ThinkingIndicator", () => {
  beforeEach(() => {
    /* Keep periodic typing loop deterministic. */
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("uses Telegram typing action instead of sending indicator messages", async () => {
    /* UX requirement: show native 'bot is typing' status, not chat noise. */
    const sendChatAction = jest.fn(async () => true);
    const sendMessage = jest.fn(async () => ({ message_id: 1 }));
    const bot = {
      telegram: {
        sendChatAction,
        sendMessage
      }
    } as any;

    const indicator = new ThinkingIndicator(bot);
    await indicator.start(100);

    expect(sendChatAction).toHaveBeenCalledWith(100, "typing");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stops typing heartbeat after stop call", async () => {
    /* Stop must clear periodic updates to avoid extra API calls. */
    const sendChatAction = jest.fn(async () => true);
    const bot = { telegram: { sendChatAction } } as any;

    const indicator = new ThinkingIndicator(bot);
    await indicator.start(200);
    jest.advanceTimersByTime(12_000);
    await Promise.resolve();

    const callsBeforeStop = sendChatAction.mock.calls.length;
    await indicator.stop(200);
    jest.advanceTimersByTime(12_000);
    await Promise.resolve();

    expect(sendChatAction.mock.calls.length).toBe(callsBeforeStop);
  });
});
