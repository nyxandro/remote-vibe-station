/**
 * @fileoverview Telegram typing activity indicator for long-running tasks.
 *
 * Why:
 * - Telegram already has native typing UX and users expect it.
 * - We avoid noisy temporary messages in chat history.
 *
 * Notes:
 * - Telegram typing status naturally expires, so we renew it on an interval.
 * - We keep one heartbeat timer per chat and stop it on final response.
 *
 * Exports:
 * - ThinkingIndicator (L26) - Starts/stops per-chat typing heartbeat.
 */

import { Telegraf } from "telegraf";

/* Telegram typing state is short-lived; refresh before it disappears. */
const TYPING_REFRESH_INTERVAL_MS = 4000;

export class ThinkingIndicator {
  private readonly timerByChatId = new Map<number, NodeJS.Timeout>();

  public constructor(private readonly bot: Telegraf) {}

  public async start(chatId: number): Promise<void> {
    /* Ensure only one indicator per chat. */
    await this.stop(chatId);

    const timer = setInterval(() => {
      void this.sendTyping(chatId);
    }, TYPING_REFRESH_INTERVAL_MS);
    this.timerByChatId.set(chatId, timer);
    await this.sendTyping(chatId);
  }

  public async stop(chatId: number): Promise<void> {
    /* Stop heartbeat timer if it exists. */
    const timer = this.timerByChatId.get(chatId);
    if (!timer) {
      return;
    }

    clearInterval(timer);
    this.timerByChatId.delete(chatId);
  }

  public async stopAll(): Promise<void> {
    /* Used on shutdown paths. */
    const chatIds = Array.from(this.timerByChatId.keys());
    for (const chatId of chatIds) {
      await this.stop(chatId);
    }
  }

  private async sendTyping(chatId: number): Promise<void> {
    /* Guard against stale timers that might fire after stop(). */
    if (!this.timerByChatId.has(chatId)) {
      return;
    }

    try {
      await this.bot.telegram.sendChatAction(chatId, "typing");
    } catch (error) {
      /* Keep polling loop resilient during transient Telegram API failures. */
      // eslint-disable-next-line no-console
      console.error("Typing indicator send failed", error);
    }
  }
}
