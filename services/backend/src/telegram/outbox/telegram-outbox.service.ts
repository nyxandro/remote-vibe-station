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
import { formatTelegramFooter } from "./telegram-footer";
import { splitTelegramTextWithFooter } from "./telegram-split-with-footer";

type AssistantDelivery = {
  text: string;
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

    const trace = buildTrace(input.delivery.telemetry);
    const body = trace ? `${input.delivery.text}\n\n${trace}` : input.delivery.text;

    /* Final answer phase must hide thinking indicator. */
    this.enqueueThinkingControl({ adminId: input.adminId, action: "stop" });

    const chunks = splitTelegramTextWithFooter(body, footer);
    chunks.forEach((chunk, index) => {
      /* Keep intermediate chunks silent, notify only on the final chunk. */
      const isFinalChunk = index === chunks.length - 1;
      const html = renderTelegramHtmlFromMarkdown(chunk);
      this.outbox.enqueue({
        adminId: input.adminId,
        chatId: binding.chatId,
        text: html,
        parseMode: "HTML",
        disableNotification: !isFinalChunk
      });
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
}
