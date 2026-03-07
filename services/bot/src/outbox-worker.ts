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

import { buildBotBackendHeaders } from "./backend-auth";
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
    mode?: "send" | "replace" | "draft";
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
const POLL_INTERVAL_MS = 300;
const PULL_LIMIT = 10;
const TELEGRAM_DRAFT_UNSUPPORTED = /sendMessageDraft|method .*not found|unsupported/i;
const TELEGRAM_DRAFT_MAX_CHARS = 3900;
const TELEGRAM_DRAFT_ID_MAX = 2147483646;

const isMessageCantBeEditedError = (error: unknown): boolean => {
  /* Telegram returns this text when edit target is not editable anymore. */
  const message = error instanceof Error ? error.message : "";
  return typeof message === "string" && message.includes("message can't be edited");
};

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
  private draftDeliverySupported = true;
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
      headers: buildBotBackendHeaders(this.config, adminId, {
        [WORKER_HEADER]: this.workerId
      })
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
      headers: buildBotBackendHeaders(this.config, adminId, {
        "Content-Type": "application/json",
        [WORKER_HEADER]: this.workerId
      }),
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
        headers: buildBotBackendHeaders(this.config, adminId)
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

  private buildReplaceReplyMarkup(inline?: { inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> }) {
    /*
     * Keep replace-target messages editable.
     * For progress updates we only attach inline keyboard when explicitly requested.
     */
    if (!inline) {
      return undefined;
    }

    return { inline_keyboard: inline.inlineKeyboard };
  }

  private async deliver(item: {
    id: string;
    chatId: number;
    text: string;
    parseMode?: "HTML";
    disableNotification?: boolean;
    mode?: "send" | "replace" | "draft";
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

      if (item.mode === "draft" && item.progressKey) {
        return await this.deliverDraft({
          id: item.id,
          chatId: item.chatId,
          text: item.text,
          progressKey: item.progressKey
        });
      }

      if (item.mode === "replace" && item.progressKey) {
        /* Replace mode preserves one live progress message in chat history. */
        sentMessageId = await this.deliverReplace({
          chatId: item.chatId,
          text: item.text,
          parseMode: item.parseMode,
          disableNotification: item.disableNotification,
          progressKey: item.progressKey,
          replyMarkup: item.replyMarkup
        });
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

  private async deliverReplace(item: {
    chatId: number;
    text: string;
    parseMode?: "HTML";
    disableNotification?: boolean;
    progressKey: string;
    replyMarkup?: {
      inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
  }): Promise<number> {
    /* Replace mode reuses a single editable progress message whenever possible. */
    const existing = this.progressMessageByKey.get(item.progressKey);
    if (existing && existing.chatId === item.chatId) {
      const sameText = existing.text === item.text;
      const sameMarkup = this.isSameReplyMarkup(existing.replyMarkup, item.replyMarkup);
      if (!sameText || !sameMarkup) {
        try {
          /* Primary path: keep updating the same Telegram message in-place. */
          await this.bot.telegram.editMessageText(item.chatId, existing.messageId, undefined, item.text, {
            parse_mode: item.parseMode,
            reply_markup: item.replyMarkup ? { inline_keyboard: item.replyMarkup.inlineKeyboard } : undefined
          });
        } catch (error) {
          /* Recover from stale/non-editable targets by sending a fresh progress message. */
          if (!isMessageCantBeEditedError(error)) {
            throw error;
          }

          const sent = await this.bot.telegram.sendMessage(item.chatId, item.text, {
            parse_mode: item.parseMode,
            disable_notification: item.disableNotification,
            reply_markup: this.buildReplaceReplyMarkup(item.replyMarkup)
          });
          existing.messageId = sent.message_id;
        }

        existing.text = item.text;
        existing.replyMarkup = item.replyMarkup;
        existing.updatedAtMs = Date.now();
      }
      return existing.messageId;
    }

    const sent = await this.bot.telegram.sendMessage(item.chatId, item.text, {
      parse_mode: item.parseMode,
      disable_notification: item.disableNotification,
      reply_markup: this.buildReplaceReplyMarkup(item.replyMarkup)
    });
    this.progressMessageByKey.set(item.progressKey, {
      chatId: item.chatId,
      messageId: sent.message_id,
      text: item.text,
      replyMarkup: item.replyMarkup,
      updatedAtMs: Date.now()
    });
    return sent.message_id;
  }

  private async deliverDraft(item: {
    id: string;
    chatId: number;
    text: string;
    progressKey: string;
  }): Promise<ReportResult> {
    /* Draft mode uses Telegram native streaming previews and falls back when unsupported. */
    if (!this.draftDeliverySupported || typeof this.bot.telegram.callApi !== "function") {
      this.draftDeliverySupported = false;
      const telegramMessageId = await this.deliverReplace({
        chatId: item.chatId,
        text: this.normalizeDraftText(item.text),
        disableNotification: true,
        progressKey: item.progressKey
      });
      return { id: item.id, ok: true, telegramMessageId };
    }

    try {
      await (this.bot.telegram.callApi as any)("sendMessageDraft", {
        chat_id: item.chatId,
        draft_id: this.resolveDraftId(item.progressKey),
        text: this.normalizeDraftText(item.text)
      });
      return { id: item.id, ok: true };
    } catch (error) {
      if (!this.isDraftUnsupportedError(error)) {
        throw error;
      }

      this.draftDeliverySupported = false;
      const telegramMessageId = await this.deliverReplace({
        chatId: item.chatId,
        text: this.normalizeDraftText(item.text),
        disableNotification: true,
        progressKey: item.progressKey
      });
      return { id: item.id, ok: true, telegramMessageId };
    }
  }

  private resolveDraftId(progressKey: string): number {
    /* Keep one stable positive draft id per logical stream key. */
    const hash = crypto.createHash("sha256").update(progressKey).digest();
    return (hash.readUInt32BE(0) % TELEGRAM_DRAFT_ID_MAX) + 1;
  }

  private normalizeDraftText(text: string): string {
    /* Keep live draft preview inside Telegram limits while preserving the newest tail. */
    if (text.length <= TELEGRAM_DRAFT_MAX_CHARS) {
      return text;
    }

    return `...\n${text.slice(text.length - (TELEGRAM_DRAFT_MAX_CHARS - 4))}`;
  }

  private isDraftUnsupportedError(error: unknown): boolean {
    /* Disable draft path permanently when Telegram runtime does not support the new method. */
    const message = error instanceof Error ? error.message : "";
    return typeof message === "string" && TELEGRAM_DRAFT_UNSUPPORTED.test(message);
  }
}
