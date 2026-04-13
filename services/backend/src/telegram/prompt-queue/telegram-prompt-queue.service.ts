/**
 * @fileoverview Buffered Telegram prompt queue that preserves one OpenCode session per project.
 *
 * Exports:
 * - TELEGRAM_PROMPT_BUFFER_WINDOW_MS (L24) - Debounce window used to merge consecutive Telegram chunks.
 * - TelegramPromptQueueService (L31) - Buffers, validates, queues and dispatches Telegram prompts.
 */

import { Injectable, OnModuleInit } from "@nestjs/common";

import { OpenCodePromptInputPart } from "../../open-code/opencode.types";
import { normalizeOpenCodeTransportErrorMessage } from "../../open-code/opencode-transport-errors";
import { PromptService } from "../../prompt/prompt.service";
import { ProjectsService } from "../../projects/projects.service";
import { TelegramStreamStore } from "../telegram-stream.store";
import { TelegramOutboxService } from "../outbox/telegram-outbox.service";
import { TelegramPromptAttachmentsService } from "./telegram-prompt-attachments.service";
import { TelegramPromptQueueStore } from "./telegram-prompt-queue.store";
import { TelegramBufferedAttachment, TelegramPromptBuffer, TelegramQueuedAttachment } from "./telegram-prompt-queue.types";

export const TELEGRAM_PROMPT_BUFFER_WINDOW_MS = 2_000;
const ATTACHMENT_CONTEXT_MERGE_MODE = "attachment_context" as const;
const PLAIN_TEXT_MERGE_MODE = "plain_text" as const;

@Injectable()
export class TelegramPromptQueueService implements OnModuleInit {
  private readonly flushTimers = new Map<string, NodeJS.Timeout>();
  private readonly activeDispatchKeys = new Set<string>();

  public constructor(
    private readonly store: TelegramPromptQueueStore,
    private readonly streamStore: TelegramStreamStore,
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
    traceId?: string;
    text?: string;
    messageId?: number;
    attachments?: TelegramBufferedAttachment[];
  }): Promise<{ queueDepth: number; flushAt: string; position: number; buffered: boolean; merged: boolean }> {
    /* Resolve active project once at enqueue time so later dispatch is immune to project switching. */
    const traceId = String(input.traceId ?? `queue-${input.adminId}-${input.chatId}-${Date.now().toString(36)}`).trim();
    const enqueueStartedAt = Date.now();
    const activeProject = await this.projects.getActiveProject(input.adminId);
    if (!activeProject) {
      throw new Error(
        "Проект не выбран. Выберите его командой /project <slug> (например: /project my-project) или в Mini App."
      );
    }

    /* Keep queue/session isolation at the admin+project level, not per Telegram update. */
    const key = this.buildQueueKey(input.adminId, activeProject.rootPath);
    const mergeMode = this.resolveMergeMode({ text: input.text, attachments: input.attachments });
    let existingBuffer = this.store.getBuffer(key);
    const shouldFlushExistingPlainText = existingBuffer?.mergeMode === PLAIN_TEXT_MERGE_MODE && mergeMode === PLAIN_TEXT_MERGE_MODE;

    if (shouldFlushExistingPlainText) {
      /* Distinct text messages should become separate queued turns even inside the debounce window. */
      await this.flushBufferNow(key);
      existingBuffer = this.store.getBuffer(key);
    }

    const queueDepth = this.store.countOutstandingItems(key);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const flushAt = new Date(nowMs + TELEGRAM_PROMPT_BUFFER_WINDOW_MS).toISOString();
    const willMerge = this.shouldMergeIntoExistingBuffer(existingBuffer, mergeMode);
    const buffer = this.store.appendBuffer({
      traceId,
      key,
      adminId: input.adminId,
      chatId: input.chatId,
      directory: activeProject.rootPath,
      projectSlug: activeProject.slug,
      text: input.text,
      attachments: input.attachments,
      messageId: input.messageId,
      nowIso,
      flushAtIso: flushAt,
      mergeMode
    });

    // eslint-disable-next-line no-console
    console.info("[telegram-trace] backend.enqueue.accepted", {
      traceId,
      adminId: input.adminId,
      chatId: input.chatId,
      projectSlug: activeProject.slug,
      directory: activeProject.rootPath,
      queueDepth,
      position: queueDepth + 1,
      merged: willMerge,
      durationMs: Date.now() - enqueueStartedAt
    });

    this.scheduleFlush(buffer);
    return {
      queueDepth,
      flushAt,
      position: queueDepth + 1,
      buffered: true,
      merged: willMerge
    };
  }

  public async enqueueSystemPrompt(input: {
    adminId: number;
    projectSlug: string;
    directory: string;
    text: string;
  }): Promise<{ position: number }> {
    /* Backend automation may enqueue an explicit follow-up turn without waiting for a new Telegram user message. */
    const normalizedText = input.text.trim();
    if (!normalizedText) {
      throw new Error(
        "APP_TELEGRAM_SYSTEM_PROMPT_TEXT_REQUIRED: System prompt text is empty. Provide non-empty continuation text and retry."
      );
    }

    const binding = this.streamStore.get(input.adminId);
    if (!binding) {
      throw new Error(
        `APP_TELEGRAM_CHAT_BINDING_REQUIRED: Telegram chat binding is missing for admin ${input.adminId}. Send any bot message first, then retry the continuation.`
      );
    }

    const key = this.buildQueueKey(input.adminId, input.directory);
    const queueDepth = this.store.countOutstandingItems(key);
    const traceId = `system-${input.adminId}-${Date.now().toString(36)}`;
    this.store.enqueueItem({
      traceId,
      key,
      adminId: input.adminId,
      chatId: binding.chatId,
      directory: input.directory,
      projectSlug: input.projectSlug,
      text: normalizedText,
      attachments: [],
      sourceMessageIds: [],
      createdAtIso: new Date().toISOString()
    });
    this.pumpQueue(key);

    return {
      position: queueDepth + 1
    };
  }

  private buildQueueKey(adminId: number, directory: string): string {
    /* One project conversation must keep one queue, even if Telegram splits transport updates. */
    return `${adminId}:${directory}`;
  }

  private resolveMergeMode(input: {
    text?: string;
    attachments?: TelegramBufferedAttachment[];
  }): "plain_text" | "attachment_context" {
    /* Plain text messages should stay as separate turns; only attachment context is merged intentionally. */
    const attachments = Array.isArray(input.attachments) ? input.attachments : [];
    return attachments.length > 0 ? ATTACHMENT_CONTEXT_MERGE_MODE : PLAIN_TEXT_MERGE_MODE;
  }

  private shouldMergeIntoExistingBuffer(
    buffer: TelegramPromptBuffer | null,
    incomingMode: "plain_text" | "attachment_context"
  ): boolean {
    /* Attachment-led prompts may absorb quick text follow-ups, but plain text must remain one user message per turn. */
    if (!buffer) {
      return false;
    }

    return buffer.mergeMode === ATTACHMENT_CONTEXT_MERGE_MODE && incomingMode !== ATTACHMENT_CONTEXT_MERGE_MODE
      ? true
      : buffer.mergeMode === ATTACHMENT_CONTEXT_MERGE_MODE && incomingMode === ATTACHMENT_CONTEXT_MERGE_MODE;
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

    await this.materializeBuffer(buffer);
  }

  private async flushBufferNow(key: string): Promise<void> {
    /* Some input combinations intentionally break the debounce window to preserve one Telegram message per turn. */
    const buffer = this.store.getBuffer(key);
    if (!buffer) {
      return;
    }

    const existing = this.flushTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.flushTimers.delete(key);
    }

    await this.materializeBuffer(buffer);
  }

  private async materializeBuffer(buffer: TelegramPromptBuffer): Promise<void> {
    /* Shared materialization path keeps normal debounce flush and forced split behavior identical. */
    const text = buffer.textSegments.join("\n\n").trim();
    const materializeStartedAt = Date.now();

    let materialized: TelegramQueuedAttachment[] = [];
    try {
      /* Download Telegram-hosted files before the prompt enters durable queue state. */
      materialized =
        buffer.attachments.length > 0
          ? await this.attachments.materializeAttachments({ attachments: buffer.attachments })
          : [];
      this.store.enqueueItem({
        traceId: buffer.traceId,
        key: buffer.key,
        adminId: buffer.adminId,
        chatId: buffer.chatId,
        directory: buffer.directory,
        projectSlug: buffer.projectSlug,
        text,
        attachments: materialized,
        sourceMessageIds: buffer.sourceMessageIds,
        createdAtIso: new Date().toISOString()
      });
      // eslint-disable-next-line no-console
      console.info("[telegram-trace] backend.buffer.materialized", {
        traceId: buffer.traceId,
        adminId: buffer.adminId,
        chatId: buffer.chatId,
        projectSlug: buffer.projectSlug,
        textLength: text.length,
        attachmentCount: materialized.length,
        durationMs: Date.now() - materializeStartedAt
      });
      this.store.removeBuffer(buffer.key);
      this.pumpQueue(buffer.key);
    } catch (error) {
      /* Attachment preparation failures should be visible to the admin and must not block later prompts. */
      this.store.removeBuffer(buffer.key);
      await this.attachments.deleteFiles({ attachments: materialized });
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error("[telegram-trace] backend.buffer.failed", {
        traceId: buffer.traceId,
        adminId: buffer.adminId,
        chatId: buffer.chatId,
        durationMs: Date.now() - materializeStartedAt,
        error: message
      });
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
          const dispatchStartedAt = Date.now();
          // eslint-disable-next-line no-console
          console.info("[telegram-trace] backend.dispatch.started", {
            traceId: item.traceId,
            itemId: item.id,
            adminId: item.adminId,
            projectSlug: item.projectSlug,
            directory: item.directory,
            textLength: item.text.length,
            attachmentCount: item.attachments.length
          });
          const parts = this.buildPromptParts(item.text, item.attachments);
          await this.prompts.dispatchPromptParts({
            adminId: item.adminId,
            projectSlug: item.projectSlug,
            directory: item.directory,
            promptTextForTelemetry: item.text,
            parts,
            allowEmptyResponse: true,
            traceId: item.traceId
          });
          this.store.markCompleted(item.id, new Date().toISOString());
          // eslint-disable-next-line no-console
          console.info("[telegram-trace] backend.dispatch.completed", {
            traceId: item.traceId,
            itemId: item.id,
            adminId: item.adminId,
            durationMs: Date.now() - dispatchStartedAt
          });
        } catch (error) {
          const message = normalizeOpenCodeTransportErrorMessage(error);
          this.store.markFailed(item.id, new Date().toISOString(), message);
          // eslint-disable-next-line no-console
          console.error("[telegram-trace] backend.dispatch.failed", {
            traceId: item.traceId,
            itemId: item.id,
            adminId: item.adminId,
            error: message
          });
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
        url: attachment.promptUrl,
        filename: attachment.fileName
      });
    }

    if (parts.length === 0) {
      throw new Error("Queued prompt has no text and no attachments");
    }

    return parts;
  }
}
