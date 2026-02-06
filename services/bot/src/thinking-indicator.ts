/**
 * @fileoverview "Thinking..." indicator message with animated dots.
 *
 * Why:
 * - Telegram chat should acknowledge long-running work.
 * - We keep the UI in a single message (edit) and delete it before final output.
 *
 * Notes:
 * - Deletion is best-effort. In groups, bot may lack permissions.
 * - Animation uses message edits; keep interval conservative to avoid rate limits.
 *
 * Exports:
 * - ThinkingIndicator (L30) - Starts/stops per-chat indicator message.
 */

import { Telegraf } from "telegraf";

/* Animate progress with dots to avoid visual noise. */
const DOT_FRAMES = [".", "..", "..."] as const;

/* Update once per second to stay responsive without rate-limit pressure. */
const EDIT_INTERVAL_MS = 1000;

type Running = {
  messageId: number;
  frameIndex: number;
  timer: NodeJS.Timeout;
};

export class ThinkingIndicator {
  private readonly runningByChatId = new Map<number, Running>();

  public constructor(private readonly bot: Telegraf) {}

  public async start(chatId: number): Promise<void> {
    /* Ensure only one indicator per chat. */
    await this.stop(chatId);

    const sent = await this.bot.telegram.sendMessage(chatId, this.buildText(0));
    const messageId = sent.message_id;

    const running: Running = {
      messageId,
      frameIndex: 0,
      timer: setInterval(() => {
        void this.tick(chatId);
      }, EDIT_INTERVAL_MS)
    };

    this.runningByChatId.set(chatId, running);
  }

  public async stop(chatId: number): Promise<void> {
    /* Stop timer and delete the indicator message if it exists. */
    const running = this.runningByChatId.get(chatId);
    if (!running) {
      return;
    }

    clearInterval(running.timer);
    this.runningByChatId.delete(chatId);

    try {
      await this.bot.telegram.deleteMessage(chatId, running.messageId);
    } catch {
      /* Best-effort: ignore permission or already-deleted errors. */
    }
  }

  public async stopAll(): Promise<void> {
    /* Used on shutdown paths. */
    const chatIds = Array.from(this.runningByChatId.keys());
    for (const chatId of chatIds) {
      await this.stop(chatId);
    }
  }

  private async tick(chatId: number): Promise<void> {
    /* Edit message to show next spinner frame. */
    const running = this.runningByChatId.get(chatId);
    if (!running) {
      return;
    }

    running.frameIndex = (running.frameIndex + 1) % DOT_FRAMES.length;
    try {
      await this.bot.telegram.editMessageText(
        chatId,
        running.messageId,
        undefined,
        this.buildText(running.frameIndex)
      );
    } catch {
      /* If edits fail (rate limit), keep the indicator without crashing. */
    }
  }

  private buildText(frameIndex: number): string {
    /* Keep it short so edits are fast and reliable. */
    const dots = DOT_FRAMES[frameIndex] ?? "...";
    return `Идет процесс размышлений${dots}`;
  }
}
