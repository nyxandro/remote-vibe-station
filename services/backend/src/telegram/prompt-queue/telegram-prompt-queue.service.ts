/**
 * @fileoverview Buffered Telegram prompt queue that preserves one OpenCode session per project.
 *
 * Exports:
 * - TELEGRAM_PROMPT_BUFFER_WINDOW_MS (L24) - Debounce window used to merge consecutive Telegram chunks.
 * - TelegramPromptQueueService (L31) - Buffers, validates, queues and dispatches Telegram prompts.
 */

import { Injectable, OnModuleInit } from "@nestjs/common";

import { OpenCodePromptInputPart } from "../../open-code/opencode.types";
import { PromptService } from "../../prompt/prompt.service";
import { ProjectsService } from "../../projects/projects.service";
import { TelegramOutboxService } from "../outbox/telegram-outbox.service";
import { TelegramPromptAttachmentsService } from "./telegram-prompt-attachments.service";
import { TelegramPromptQueueStore } from "./telegram-prompt-queue.store";
import { TelegramBufferedAttachment, TelegramPromptBuffer, TelegramQueuedAttachment } from "./telegram-prompt-queue.types";

export const TELEGRAM_PROMPT_BUFFER_WINDOW_MS = 2_000;

@Injectable()
export class TelegramPromptQueueService implements OnModuleInit {
  private readonly flushTimers = new Map<string, NodeJS.Timeout>();
  private readonly activeDispatchKeys = new Set<string>();

  public constructor(
    private readonly store: TelegramPromptQueueStore,
    private readonly prompts: PromptService,
    private readonly projects: ProjectsService,
    private readonly attachments: TelegramPromptAttachmentsService,
    private readonly outbox: TelegramOutboxService
  ) {}

  public onModuleInit(): void {
    /* Restore buffered prompts and pending queue after backend restart. */
    const nowIso = new Date().toISOString();
    this.store.requeueRunningItems(nowIso);

    for (const buffer of this.store.listBuffers()) {
      this.scheduleFlush(buffer);
    }

    for (const key of this.store.listQueueKeys()) {
      this.pumpQueue(key);
    }
  }

  public async enqueueIncomingPrompt(input: {
    adminId: number;
    chatId: number;
    text?: string;
    messageId?: number;
    attachments?: TelegramBufferedAttachment[];
  }): Promise<{ queueDepth: number; flushAt: string; position: number; buffered: boolean; merged: boolean }> {
    /* Resolve active project once at enqueue time so later dispatch is immune to project switching. */
    const activeProject = await this.projects.getActiveProject(input.adminId);
    if (!activeProject) {
      throw new Error(
        "Проект не выбран. Выберите его командой /project <slug> (например: /project my-project) или в Mini App."
      );
    }

    /* Keep queue/session isolation at the admin+project level, not per Telegram update. */
    const key = this.buildQueueKey(input.adminId, activeProject.rootPath);
    const hadBuffer = this.store.getBuffer(key) !== null;
    const queueDepth = this.store.countOutstandingItems(key);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const flushAt = new Date(nowMs + TELEGRAM_PROMPT_BUFFER_WINDOW_MS).toISOString();
    const buffer = this.store.appendBuffer({
      key,
      adminId: input.adminId,
      chatId: input.chatId,
      directory: activeProject.rootPath,
      projectSlug: activeProject.slug,
      text: input.text,
      attachments: input.attachments,
      messageId: input.messageId,
      nowIso,
      flushAtIso: flushAt
    });

    this.scheduleFlush(buffer);
    return {
      queueDepth,
      flushAt,
      position: queueDepth + 1,
      buffered: true,
      merged: hadBuffer
    };
  }

  private buildQueueKey(adminId: number, directory: string): string {
    /* One project conversation must keep one queue, even if Telegram splits transport updates. */
    return `${adminId}:${directory}`;
  }

  private scheduleFlush(buffer: TelegramPromptBuffer): void {
    /* Reset debounce timer whenever a new chunk extends the same logical prompt. */
    const existing = this.flushTimers.get(buffer.key);
    if (existing) {
      clearTimeout(existing);
    }

    const delayMs = Math.max(0, Date.parse(buffer.flushAt) - Date.now());
    const timer = setTimeout(() => {
      this.flushTimers.delete(buffer.key);
      void this.flushBuffer(buffer.key);
    }, delayMs);
    this.flushTimers.set(buffer.key, timer);
  }

  private async flushBuffer(key: string): Promise<void> {
    /* Convert due debounce buffer into a durable queue item exactly once. */
    const buffer = this.store.getBuffer(key);
    if (!buffer) {
      return;
    }

    if (Date.parse(buffer.flushAt) > Date.now()) {
      this.scheduleFlush(buffer);
      return;
    }

    const text = buffer.textSegments.join("\n\n").trim();

    let materialized: TelegramQueuedAttachment[] = [];
    try {
      /* Download Telegram-hosted files before the prompt enters durable queue state. */
      materialized =
        buffer.attachments.length > 0
          ? await this.attachments.materializeAttachments({ attachments: buffer.attachments })
          : [];
      this.store.enqueueItem({
        key,
        adminId: buffer.adminId,
        chatId: buffer.chatId,
        directory: buffer.directory,
        projectSlug: buffer.projectSlug,
        text,
        attachments: materialized,
        sourceMessageIds: buffer.sourceMessageIds,
        createdAtIso: new Date().toISOString()
      });
      this.store.removeBuffer(key);
      this.pumpQueue(key);
    } catch (error) {
      /* Attachment preparation failures should be visible to the admin and must not block later prompts. */
      this.store.removeBuffer(key);
      await this.attachments.deleteFiles({ attachments: materialized });
      const message = error instanceof Error ? error.message : String(error);
      this.outbox.enqueueAdminNotification({
        adminId: buffer.adminId,
        text: `Не удалось подготовить вложение для агента: ${message}`
      });
    }
  }

  private pumpQueue(key: string): void {
    /* Keep at most one active OpenCode dispatch per admin+project queue. */
    if (this.activeDispatchKeys.has(key)) {
      return;
    }

    this.activeDispatchKeys.add(key);
    void this.runQueue(key);
  }

  private async runQueue(key: string): Promise<void> {
    /* Serial loop keeps OpenCode busy-session races away from the Telegram transport layer. */
    try {
      while (true) {
        const item = this.store.claimNextPendingItem(key, new Date().toISOString());
        if (!item) {
          return;
        }

        try {
          const parts = this.buildPromptParts(item.text, item.attachments);
          await this.prompts.dispatchPromptParts({
            adminId: item.adminId,
            projectSlug: item.projectSlug,
            directory: item.directory,
            promptTextForTelemetry: item.text,
            parts,
            allowEmptyResponse: true
          });
          this.store.markCompleted(item.id, new Date().toISOString());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.store.markFailed(item.id, new Date().toISOString(), message);
          this.outbox.enqueueAdminNotification({
            adminId: item.adminId,
            text: `Ошибка запроса: ${message}`
          });
        } finally {
          await this.attachments.deleteFiles({ attachments: item.attachments });
        }
      }
    } finally {
      this.activeDispatchKeys.delete(key);
      if (this.store.countOutstandingItems(key) > 0) {
        this.pumpQueue(key);
      }
    }
  }

  private buildPromptParts(text: string, attachments: TelegramQueuedAttachment[]): OpenCodePromptInputPart[] {
    /* Preserve optional text instruction plus all prepared attachments in the same OpenCode turn. */
    const parts: OpenCodePromptInputPart[] = [];

    if (text.length > 0) {
      parts.push({ type: "text", text });
    }

    for (const attachment of attachments) {
      parts.push({
        type: "file",
        mime: attachment.mimeType,
        url: `file://${attachment.localPath}`,
        filename: attachment.fileName
      });
    }

    if (parts.length === 0) {
      throw new Error("Queued prompt has no text and no attachments");
    }

    return parts;
  }
}
