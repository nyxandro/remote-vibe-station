/**
 * @fileoverview Reliable Telegram delivery worker.
 *
 * Polls backend outbox and delivers messages to Telegram with retries.
 * Backend is the source of truth and persists message state.
 *
 * Exports:
 * - OutboxWorker (L23) - Starts polling loop.
 */

import * as crypto from "node:crypto";

import { Telegraf } from "telegraf";

import { BotConfig } from "./config";
import { buildModeButtonText } from "./mode-control";
import { ThinkingIndicator } from "./thinking-indicator";

type PullResponse = {
  items: Array<{
    id: string;
    chatId: number;
    text: string;
    parseMode?: "HTML";
    disableNotification?: boolean;
    mode?: "send" | "replace";
    progressKey?: string;
    control?: {
      kind: "thinking";
      action: "start" | "stop";
    };
    replyMarkup?: {
      inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
  }>;
};

type ReportResult = {
  id: string;
  ok: boolean;
  telegramMessageId?: number;
  error?: string;
  retryAfterSec?: number;
};

const WORKER_HEADER = "x-bot-worker-id";
const POLL_INTERVAL_MS = 1000;
const PULL_LIMIT = 10;

export class OutboxWorker {
  private readonly workerId: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly progressMessageByKey = new Map<
    string,
    {
      chatId: number;
      messageId: number;
      text: string;
      replyMarkup?: { inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> };
      updatedAtMs: number;
    }
  >();
  private readonly modeProjectByChatId = new Map<number, string>();

  public constructor(
    private readonly config: BotConfig,
    private readonly bot: Telegraf,
    private readonly indicator?: ThinkingIndicator
  ) {
    /* Use a stable id for leasing; changes on each process start. */
    this.workerId = crypto.randomUUID();
  }

  public start(): void {
    /* Start the polling loop. */
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);

    /* Run immediately on startup to reduce perceived latency. */
    void this.tick();
  }

  private async tick(): Promise<void> {
    /* Ensure single tick execution to avoid overlapping polls. */
    if (this.running) {
      return;
    }
    this.running = true;

    try {
      for (const adminId of this.config.adminIds) {
        await this.processAdmin(adminId);
      }
      this.pruneProgressMap(Date.now());
    } catch {
      /* Never crash bot on worker errors. */
    } finally {
      this.running = false;
    }
  }

  private async processAdmin(adminId: number): Promise<void> {
    /* Pull a batch and deliver sequentially to respect rate limits. */
    const pulled = await this.pull(adminId);
    if (!pulled.items.length) {
      return;
    }

    /* Snapshot active project once per batch to keep reply-button label in sync. */
    const activeProjectSlug = await this.fetchActiveProjectSlug(adminId);
    if (activeProjectSlug) {
      pulled.items.forEach((item) => {
        this.modeProjectByChatId.set(item.chatId, activeProjectSlug);
      });
    }

    const results: ReportResult[] = [];
    for (const item of pulled.items) {
      results.push(await this.deliver(item));
    }

    await this.report(adminId, results);
  }

  private async pull(adminId: number): Promise<PullResponse> {
    /* Fetch leased pending items from backend. */
    const url = `${this.config.backendUrl}/api/telegram/outbox/pull?limit=${PULL_LIMIT}`;
    const response = await fetch(url, {
      headers: {
        "x-admin-id": String(adminId),
        [WORKER_HEADER]: this.workerId
      }
    });

    if (!response.ok) {
      return { items: [] };
    }

    return (await response.json()) as PullResponse;
  }

  private async report(adminId: number, results: ReportResult[]): Promise<void> {
    /* Persist delivery outcome on backend. */
    if (results.length === 0) {
      return;
    }

    const response = await fetch(`${this.config.backendUrl}/api/telegram/outbox/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-id": String(adminId),
        [WORKER_HEADER]: this.workerId
      },
      body: JSON.stringify({ results })
    });

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error("Outbox report failed", {
        adminId,
        workerId: this.workerId,
        status: response.status,
        body: await response.text()
      });
    }
  }

  private async fetchActiveProjectSlug(adminId: number): Promise<string | null> {
    /* Keep bot resilient: mode label refresh must never block message delivery. */
    try {
      const response = await fetch(`${this.config.backendUrl}/api/admin/projects/active`, {
        headers: {
          "x-admin-id": String(adminId)
        }
      });

      if (!response.ok) {
        return null;
      }

      const body = (await response.json()) as { slug?: unknown } | null;
      const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
      return slug.length > 0 ? slug : null;
    } catch {
      return null;
    }
  }

  private isSameReplyMarkup(
    a?: { inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> },
    b?: { inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> }
  ): boolean {
    /* Compare inline keyboard payloads to avoid missing markup-only changes. */
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }

  private pruneProgressMap(nowMs: number): void {
    /* Bounded cleanup for long-running bots with many progress keys. */
    const ttlMs = 30 * 60_000;
    for (const [key, value] of this.progressMessageByKey.entries()) {
      if (nowMs - value.updatedAtMs > ttlMs) {
        this.progressMessageByKey.delete(key);
      }
    }

    /* Keep mode project cache bounded similarly to progress map lifecycle. */
    if (this.modeProjectByChatId.size > 5000) {
      this.modeProjectByChatId.clear();
    }
  }

  private buildReplyMarkup(
    chatId: number,
    inline?: { inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> }
  ) {
    /*
     * Keep inline keyboard priority for action messages.
     * For plain messages, render persistent mode button with active project suffix.
     */
    if (inline) {
      return { inline_keyboard: inline.inlineKeyboard };
    }

    const buttonText = buildModeButtonText(this.modeProjectByChatId.get(chatId));
    return {
      keyboard: [[{ text: buttonText }]],
      resize_keyboard: true
    };
  }

  private async deliver(item: {
    id: string;
    chatId: number;
    text: string;
    parseMode?: "HTML";
    disableNotification?: boolean;
    mode?: "send" | "replace";
    progressKey?: string;
    control?: {
      kind: "thinking";
      action: "start" | "stop";
    };
    replyMarkup?: {
      inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
  }): Promise<ReportResult> {
    /* Attempt to send a single Telegram message. */
    try {
      if (item.control?.kind === "thinking") {
        /* Execute bot-local indicator control command. */
        if (this.indicator) {
          if (item.control.action === "start") {
            await this.indicator.start(item.chatId);
          } else {
            await this.indicator.stop(item.chatId);
          }
        }

        return { id: item.id, ok: true };
      }

      let sentMessageId: number;

      if (item.mode === "replace" && item.progressKey) {
        /* Reuse same message via editMessageText for live progress. */
        const existing = this.progressMessageByKey.get(item.progressKey);
        if (existing && existing.chatId === item.chatId) {
          const sameText = existing.text === item.text;
          const sameMarkup = this.isSameReplyMarkup(existing.replyMarkup, item.replyMarkup);
          if (!sameText || !sameMarkup) {
            await this.bot.telegram.editMessageText(item.chatId, existing.messageId, undefined, item.text, {
              parse_mode: item.parseMode,
              reply_markup: item.replyMarkup ? { inline_keyboard: item.replyMarkup.inlineKeyboard } : undefined
            });
            existing.text = item.text;
            existing.replyMarkup = item.replyMarkup;
            existing.updatedAtMs = Date.now();
          }
          sentMessageId = existing.messageId;
        } else {
          const sent = await this.bot.telegram.sendMessage(item.chatId, item.text, {
            parse_mode: item.parseMode,
            disable_notification: item.disableNotification,
            reply_markup: this.buildReplyMarkup(item.chatId, item.replyMarkup)
          });
          sentMessageId = sent.message_id;
          this.progressMessageByKey.set(item.progressKey, {
            chatId: item.chatId,
            messageId: sent.message_id,
            text: item.text,
            replyMarkup: item.replyMarkup,
            updatedAtMs: Date.now()
          });
        }
      } else {
        const sent = await this.bot.telegram.sendMessage(item.chatId, item.text, {
          parse_mode: item.parseMode,
          disable_notification: item.disableNotification,
          reply_markup: this.buildReplyMarkup(item.chatId, item.replyMarkup)
        });
        sentMessageId = sent.message_id;
      }

      return { id: item.id, ok: true, telegramMessageId: sentMessageId };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : "Failed to send Telegram message";
      if (typeof message === "string" && message.includes("message is not modified")) {
        /* Telegram edit can fail when content is identical; treat as delivered. */
        return { id: item.id, ok: true };
      }

      /*
       * Telegram may respond with rate limit parameters.
       * We pass retry_after seconds to backend so it can schedule correctly.
       */
      const retryAfter = Number(error?.parameters?.retry_after);
      const retryAfterSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
      return { id: item.id, ok: false, error: message, retryAfterSec };
    }
  }
}
