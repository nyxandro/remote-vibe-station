/**
 * @fileoverview High-level API for reliable Telegram delivery.
 *
 * Responsibilities:
 * - Decide whether a message should be delivered (based on stream settings).
 * - Split text to Telegram-safe chunks.
 * - Enqueue chunks into the persistent outbox.
 *
 * Exports:
 * - TelegramOutboxService (L23) - Enqueue helpers for event producers.
 */

import { Injectable } from "@nestjs/common";

import { TelegramStreamStore } from "../telegram-stream.store";
import { renderTelegramHtmlFromMarkdown } from "./telegram-markdown";
import { TelegramOutboxStore } from "./telegram-outbox.store";
import { formatTelegramFooter, renderTelegramFooterHtml } from "./telegram-footer";
import { splitTelegramTextWithFooter } from "./telegram-split-with-footer";

type AssistantDelivery = {
  text: string;
  sessionId?: string | null;
  contextLimit?: number | null;
  providerID: string;
  modelID: string;
  thinking?: string | null;
  agent: string;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache?: { read: number; write: number };
  };
  telemetry?: {
    tools?: Array<{ tool: string; state: string }>;
    patches?: Array<{ hash: string; files: string[] }>;
    fileChanges?: Array<{ kind: "create" | "edit" | "delete"; path: string; additions: number; deletions: number }>;
    commands?: Array<{ command: string; output: string }>;
    subtasks?: Array<{ description: string; agent: string; command?: string; model?: { providerID: string; modelID: string } }>;
  };
};

const buildTrace = (telemetry?: AssistantDelivery["telemetry"]): string => {
  /* Compact, factual trace. Avoid reasoning content. */
  if (!telemetry) {
    return "";
  }

  const lines: string[] = [];

  const tools = telemetry.tools ?? [];
  if (tools.length) {
    lines.push("Инструменты:");
    tools.slice(0, 10).forEach((t) => {
      lines.push(`- ${t.tool} (${t.state})`);
    });
    if (tools.length > 10) {
      lines.push(`- ...ещё ${tools.length - 10}`);
    }
  }

  const patches = telemetry.patches ?? [];
  if (patches.length) {
    lines.push("Патчи:");
    patches.slice(0, 5).forEach((p) => {
      const files = (p.files ?? []).slice(0, 8).join(", ");
      const suffix = (p.files ?? []).length > 8 ? `, ...ещё ${(p.files ?? []).length - 8}` : "";
      lines.push(`- ${p.hash}: ${files}${suffix}`);
    });
    if (patches.length > 5) {
      lines.push(`- ...ещё ${patches.length - 5}`);
    }
  }

  const fileChanges = telemetry.fileChanges ?? [];
  if (fileChanges.length) {
    lines.push("Файлы:");
    fileChanges.slice(0, 20).forEach((change) => {
      const normalizedPath = change.path;
      if (change.kind === "create") {
        lines.push(`- Создание файла ${normalizedPath} +${change.additions}`);
        return;
      }

      if (change.kind === "delete") {
        lines.push(`- Удаление файла ${normalizedPath} -${change.deletions}`);
        return;
      }

      lines.push(`- Редактирование файла ${normalizedPath} +${change.additions} -${change.deletions}`);
    });
    if (fileChanges.length > 20) {
      lines.push(`- ...ещё ${fileChanges.length - 20}`);
    }
  }

  const commands = telemetry.commands ?? [];
  if (commands.length) {
    lines.push("Команды:");
    commands.slice(0, 5).forEach((item) => {
      const output = item.output.length > 600 ? `${item.output.slice(0, 600)}\n...` : item.output;
      const block = ["```bash", `$ ${item.command}`, output, "```"].join("\n");
      lines.push(block);
    });
    if (commands.length > 5) {
      lines.push(`- ...ещё ${commands.length - 5}`);
    }
  }

  const subtasks = telemetry.subtasks ?? [];
  if (subtasks.length) {
    lines.push("Сабтаски:");
    subtasks.slice(0, 5).forEach((s) => {
      const label = s.description || "(без описания)";
      lines.push(`- ${label} [${s.agent}]`);
    });
    if (subtasks.length > 5) {
      lines.push(`- ...ещё ${subtasks.length - 5}`);
    }
  }

  return lines.join("\n");
};

@Injectable()
export class TelegramOutboxService {
  private readonly assistantResponseSeqBySession = new Map<string, number>();
  private readonly activeAssistantProgressKeyBySession = new Map<string, string>();

  public constructor(
    private readonly streamStore: TelegramStreamStore,
    private readonly outbox: TelegramOutboxStore
  ) {}

  public enqueueAssistantReply(input: { adminId: number; delivery: AssistantDelivery }): void {
    /*
     * Assistant replies should be delivered even when stream is toggled off.
     * This preserves current UX: /end disables streaming noise, not answers.
     */
    const binding = this.streamStore.get(input.adminId);
    if (!binding) {
      return;
    }

    const contextUsed =
      Number(input.delivery.tokens?.input ?? 0) + Number(input.delivery.tokens?.cache?.read ?? 0);

    const footer = formatTelegramFooter({
      contextUsedTokens: contextUsed,
      contextLimitTokens: input.delivery.contextLimit,
      providerID: input.delivery.providerID,
      modelID: input.delivery.modelID,
      thinking: input.delivery.thinking,
      agent: input.delivery.agent
    });
    const footerHtml = renderTelegramFooterHtml({
      contextUsedTokens: contextUsed,
      contextLimitTokens: input.delivery.contextLimit,
      providerID: input.delivery.providerID,
      modelID: input.delivery.modelID,
      thinking: input.delivery.thinking,
      agent: input.delivery.agent
    });

    const trace = buildTrace(input.delivery.telemetry);
    const body = trace ? `${input.delivery.text}\n\n${trace}` : input.delivery.text;

    /* Final answer phase must hide thinking indicator. */
    this.enqueueThinkingControl({ adminId: input.adminId, action: "stop" });

    const chunks = splitTelegramTextWithFooter(body, footer);
    const streamProgressKey = input.delivery.sessionId
      ? this.resolveAssistantProgressKey({
          adminId: input.adminId,
          sessionId: input.delivery.sessionId,
          createIfMissing: true
        })
      : null;

    if (binding.streamEnabled && streamProgressKey && chunks.length > 0) {
      /* Reuse the live streamed message as the first final chunk to avoid duplicates. */
        const renderedChunk = this.ensureRenderedFooter({
          html: renderTelegramHtmlFromMarkdown(chunks[0]),
          isFinalChunk: chunks.length === 1,
          footerHtml
        });
        this.outbox.enqueue({
          adminId: input.adminId,
          chatId: binding.chatId,
          text: renderedChunk,
          parseMode: "HTML",
          disableNotification: chunks.length > 1,
          mode: "replace",
        progressKey: streamProgressKey
      });

      chunks.slice(1).forEach((chunk, index) => {
        const isFinalChunk = index === chunks.length - 2;
        const renderedChunk = this.ensureRenderedFooter({
          html: renderTelegramHtmlFromMarkdown(chunk),
          isFinalChunk,
          footerHtml
        });
        this.outbox.enqueue({
          adminId: input.adminId,
          chatId: binding.chatId,
          text: renderedChunk,
          parseMode: "HTML",
          disableNotification: !isFinalChunk
        });
      });
      this.clearAssistantProgressKey(input.delivery.sessionId ?? null);
      return;
    }

    chunks.forEach((chunk, index) => {
      /* Keep intermediate chunks silent, notify only on the final chunk. */
      const isFinalChunk = index === chunks.length - 1;
      const html = this.ensureRenderedFooter({
        html: renderTelegramHtmlFromMarkdown(chunk),
        isFinalChunk,
        footerHtml
      });
      this.outbox.enqueue({
        adminId: input.adminId,
        chatId: binding.chatId,
        text: html,
        parseMode: "HTML",
        disableNotification: !isFinalChunk
      });
    });
    this.clearAssistantProgressKey(input.delivery.sessionId ?? null);
  }

  private ensureRenderedFooter(input: { html: string; isFinalChunk: boolean; footerHtml: string }): string {
    /* Final reply must always end with the metadata quote block even if chunk rendering path changes. */
    if (!input.isFinalChunk || input.html.includes(input.footerHtml)) {
      return input.html;
    }

    return input.html.trim().length > 0 ? `${input.html}\n\n${input.footerHtml}` : input.footerHtml;
  }

  public enqueueAssistantCommentary(input: { adminId: number; text: string }): void {
    /* Commentary blocks between tools should appear as fresh chat messages, not progress edits. */
    const binding = this.streamStore.get(input.adminId);
    if (!binding) {
      return;
    }

    const chunks = splitTelegramTextWithFooter(input.text, "");
    chunks.forEach((chunk) => {
      /* Keep commentary silent because it is operational stream output, not a direct mention-worthy ping. */
      this.outbox.enqueue({
        adminId: input.adminId,
        chatId: binding.chatId,
        text: renderTelegramHtmlFromMarkdown(chunk),
        parseMode: "HTML",
        disableNotification: true
      });
    });
  }

  public enqueueAssistantStreamDelta(input: { adminId: number; sessionId: string; text: string; progressKey?: string }): void {
    /* Route one assistant delta into the currently active live Telegram message for this response. */
    const progressKey = this.resolveAssistantProgressKey({
      adminId: input.adminId,
      sessionId: input.sessionId,
      progressKey: (input as { progressKey?: string }).progressKey,
      createIfMissing: true
    });
    if (!progressKey) {
      return;
    }

    this.enqueueProgressReplace({
      adminId: input.adminId,
      progressKey,
      text: input.text,
      disableNotification: true
    });
  }

  public enqueueStreamNotification(input: { adminId: number; text: string; parseMode?: "HTML" }): void {
    /* Only deliver when stream is enabled for the admin. */
    const binding = this.streamStore.get(input.adminId);
    if (!binding || !binding.streamEnabled) {
      return;
    }

    const chunks = splitTelegramTextWithFooter(input.text, "");
    chunks.forEach((chunk) => {
      this.outbox.enqueue({
        adminId: input.adminId,
        chatId: binding.chatId,
        text: chunk,
        parseMode: input.parseMode,
        disableNotification: true
      });
    });
  }

  public enqueueAdminNotification(input: { adminId: number; text: string; parseMode?: "HTML" }): void {
    /*
     * Deliver operational notifications to the admin chat even when stream is disabled.
     * Use disableNotification=true to avoid noisy pings.
     */
    const binding = this.streamStore.get(input.adminId);
    if (!binding) {
      return;
    }

    const chunks = splitTelegramTextWithFooter(input.text, "");
    chunks.forEach((chunk) => {
      this.outbox.enqueue({
        adminId: input.adminId,
        chatId: binding.chatId,
        text: chunk,
        parseMode: input.parseMode,
        disableNotification: true
      });
    });
  }

  public enqueueProgressReplace(input: {
    adminId: number;
    progressKey: string;
    text: string;
    parseMode?: "HTML";
    disableNotification?: boolean;
    replyMarkup?: {
      inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
  }): void {
    /*
     * Runtime progress should reuse one Telegram message when possible.
     * Worker applies replace semantics by progressKey.
     */
    const binding = this.streamStore.get(input.adminId);
    if (!binding) {
      return;
    }

    this.outbox.enqueue({
      adminId: input.adminId,
      chatId: binding.chatId,
      text: input.text,
      parseMode: input.parseMode,
      disableNotification: input.disableNotification ?? true,
      mode: "replace",
      progressKey: input.progressKey,
      replyMarkup: input.replyMarkup
    });
  }

  public enqueueProgressDraft(input: {
    adminId: number;
    progressKey: string;
    text: string;
  }): void {
    /* Stream partial assistant text through Telegram drafts with one stable key per response. */
    const binding = this.streamStore.get(input.adminId);
    if (!binding || !binding.streamEnabled) {
      return;
    }

    this.outbox.enqueue({
      adminId: input.adminId,
      chatId: binding.chatId,
      text: input.text,
      disableNotification: true,
      mode: "draft",
      progressKey: input.progressKey
    });
  }

  public enqueueThinkingControl(input: { adminId: number; action: "start" | "stop" }): void {
    /* Send explicit control command to bot-side indicator manager. */
    const binding = this.streamStore.get(input.adminId);
    if (!binding) {
      return;
    }

    this.outbox.enqueue({
      adminId: input.adminId,
      chatId: binding.chatId,
      text: "",
      disableNotification: true,
      control: {
        kind: "thinking",
        action: input.action
      }
    });
  }

  public closeAssistantProgress(input: { sessionId: string | null }): void {
    /* Blocking question/permission steps must force the next assistant continuation into a fresh Telegram message. */
    this.clearAssistantProgressKey(input.sessionId);
  }

  private resolveAssistantProgressKey(input: {
    adminId: number;
    sessionId: string;
    progressKey?: string;
    createIfMissing: boolean;
  }): string | null {
    /* Keep one live Telegram message per assistant response, not per whole OpenCode session. */
    if (input.progressKey) {
      this.activeAssistantProgressKeyBySession.set(input.sessionId, input.progressKey);
      return input.progressKey;
    }

    const existing = this.activeAssistantProgressKeyBySession.get(input.sessionId);
    if (existing) {
      return existing;
    }

    if (!input.createIfMissing) {
      return null;
    }

    const nextSeq = (this.assistantResponseSeqBySession.get(input.sessionId) ?? 0) + 1;
    this.assistantResponseSeqBySession.set(input.sessionId, nextSeq);

    const progressKey = `assistant:${input.adminId}:${input.sessionId}:${nextSeq}`;
    this.activeAssistantProgressKeyBySession.set(input.sessionId, progressKey);
    return progressKey;
  }

  private clearAssistantProgressKey(sessionId: string | null): void {
    /* Final answer closes the current live message so the next reply gets a fresh one. */
    if (!sessionId) {
      return;
    }

    this.activeAssistantProgressKeyBySession.delete(sessionId);
  }
}
