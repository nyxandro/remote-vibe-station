/**
 * @fileoverview Live bridge for OpenCode runtime events into Telegram outbox.
 *
 * Exports:
 * - TelegramOpenCodeRuntimeBridge (L24) - Parses opencode.event and enqueues progress/questions.
 */

import { Inject, Injectable, OnModuleInit } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../../config/config.types";
import { EventEnvelope } from "../../events/events.types";
import { EventsService } from "../../events/events.service";
import { OpenCodeSessionRoutingStore } from "../../open-code/opencode-session-routing.store";
import { TelegramDiffPreviewStore } from "../diff-preview/telegram-diff-preview.store";
import { formatFileOperationMessageHtml } from "./telegram-file-event-message";
import { TelegramOutboxService } from "./telegram-outbox.service";

type OpenCodeBusEvent = {
  type?: string;
  properties?: Record<string, unknown>;
};

const BASH_PROGRESS_MAX_CHARS = 2600;
const BASH_PROGRESS_MIN_INTERVAL_MS = 1000;
const BASH_NOISE_PROBE_COMMAND = /^(node|npm|pnpm|yarn|bun|python|python3)\s+(-v|--version)$/i;
const QUESTION_CALLBACK_PREFIX = "q";
const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_DEEP_LINK_BASE = "https://t.me";
const DIFF_START_PARAM_PREFIX = "diff_";

type ExtractedFileOperation = {
  kind: "create" | "edit" | "delete";
  absolutePath: string;
  additions: number;
  deletions: number;
  diff: string;
  before?: string;
  after?: string;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const isNoisyRuntimeProbeCommand = (command: string): boolean => {
  /* Suppress low-signal version probes to keep Telegram terminal stream useful. */
  const normalized = command.trim().replaceAll(/\s+/g, " ");
  return BASH_NOISE_PROBE_COMMAND.test(normalized);
};

@Injectable()
export class TelegramOpenCodeRuntimeBridge implements OnModuleInit {
  private readonly bashProgressEmittedAtMs = new Map<string, number>();
  private readonly bashProgressKeyByPart = new Map<string, string>();
  private readonly thinkingActiveBySession = new Map<string, boolean>();
  private botUsernamePromise: Promise<string | null> | null = null;

  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly events: EventsService,
    private readonly routes: OpenCodeSessionRoutingStore,
    private readonly outbox: TelegramOutboxService,
    private readonly diffPreviews: TelegramDiffPreviewStore
  ) {}

  public onModuleInit(): void {
    /* Subscribe once and process OpenCode runtime events in background. */
    this.events.subscribe((event) => this.onEvent(event));
  }

  private onEvent(event: EventEnvelope): void {
    /* Accept only raw OpenCode SSE events published by OpenCodeEventsService. */
    if (event.type !== "opencode.event") {
      return;
    }

    const payload = String((event.data as any)?.payload ?? "");
    if (!payload) {
      return;
    }

    let parsed: OpenCodeBusEvent;
    try {
      parsed = JSON.parse(payload) as OpenCodeBusEvent;
    } catch {
      return;
    }

    const eventType = String(parsed.type ?? "");
    if (eventType === "message.part.updated") {
      this.handlePartUpdated(parsed.properties ?? {});
      return;
    }

    if (eventType === "session.status") {
      this.handleSessionStatus(parsed.properties ?? {});
      return;
    }

    if (eventType === "session.idle") {
      this.handleSessionIdle(parsed.properties ?? {});
      return;
    }

    if (eventType === "question.asked") {
      this.handleQuestionAsked(parsed.properties ?? {});
    }
  }

  private handlePartUpdated(properties: Record<string, unknown>): void {
    /* Handle tool runtime updates to show file activity and live terminal output. */
    const part = properties.part as any;
    if (!part) {
      return;
    }

    const sessionID = String(part.sessionID ?? "");
    const route = this.routes.resolve(sessionID);
    if (!route) {
      return;
    }

    const partType = String(part.type ?? "");
    if (partType === "reasoning") {
      this.setThinking(route.adminId, sessionID, true);
    } else if (partType === "tool" || partType === "text") {
      this.setThinking(route.adminId, sessionID, false);
    }

    if (partType !== "tool") {
      return;
    }

    const toolName = String(part.tool ?? "");
    const state = part.state as any;
    const status = String(state?.status ?? "");

    if (toolName === "bash") {
      const command = String(state?.input?.command ?? "").trim();
      if (!command) {
        return;
      }

      /* Do not emit standalone progress cards for routine runtime version checks. */
      if (isNoisyRuntimeProbeCommand(command)) {
        return;
      }

      const outputRaw = String(state?.metadata?.output ?? state?.output ?? "");
      const output =
        outputRaw.length > BASH_PROGRESS_MAX_CHARS
          ? `${outputRaw.slice(0, BASH_PROGRESS_MAX_CHARS)}\n...`
          : outputRaw;
      const header = status === "completed" ? "✅ Команда завершена" : status === "error" ? "❌ Команда с ошибкой" : "⏳ Выполняю команду";
      const progressKey = this.resolveBashProgressKey({
        adminId: route.adminId,
        sessionID,
        part,
        command,
        status
      });
      const nowMs = Date.now();
      const last = this.bashProgressEmittedAtMs.get(progressKey) ?? 0;
      const isFinal = status === "completed" || status === "error";
      if (!isFinal && nowMs - last < BASH_PROGRESS_MIN_INTERVAL_MS) {
        return;
      }

      const body = [
        escapeHtml(header),
        `<pre><code class="language-bash">${escapeHtml(`$ ${command}\n${output}`)}</code></pre>`
      ].join("\n");

      this.outbox.enqueueProgressReplace({
        adminId: route.adminId,
        progressKey,
        text: body,
        parseMode: "HTML"
      });

      this.bashProgressEmittedAtMs.set(progressKey, nowMs);
      if (isFinal) {
        this.bashProgressEmittedAtMs.delete(progressKey);
      }
      return;
    }

    if (status !== "completed") {
      return;
    }

    void this.emitFileOperations(part, route);
  }

  private resolveBashProgressKey(input: {
    adminId: number;
    sessionID: string;
    part: any;
    command: string;
    status: string;
  }): string {
    /*
     * Keep one replace key per logical bash tool part.
     * OpenCode may rotate callID between partial updates, so id/session binding is the stable anchor.
     */
    const callId = String(input.part.callID ?? "").trim();
    const partId = String(input.part.id ?? "").trim();

    /*
     * Runtime can rotate both callID and part.id between partial updates.
     * For live terminal output we bind one replace slot to session+command.
     */
    const stablePartToken = `cmd:${input.command}`;
    const mapKey = `bash-part:${input.adminId}:${input.sessionID}:${stablePartToken}`;
    const existing = this.bashProgressKeyByPart.get(mapKey);
    if (existing) {
      if (input.status === "completed" || input.status === "error") {
        this.bashProgressKeyByPart.delete(mapKey);
      }
      return existing;
    }

    const progressIdentity = partId || callId || input.command;
    const progressKey = `bash:${input.adminId}:${input.sessionID}:${progressIdentity}`;
    if (input.status !== "completed" && input.status !== "error") {
      this.bashProgressKeyByPart.set(mapKey, progressKey);
    }
    return progressKey;
  }

  private handleSessionStatus(properties: Record<string, unknown>): void {
    /* Stop indicator when session transitions to idle state. */
    const sessionID = String(properties.sessionID ?? "");
    if (!sessionID) {
      return;
    }

    const route = this.routes.resolve(sessionID);
    if (!route) {
      return;
    }

    const statusType = String((properties.status as any)?.type ?? "");
    if (statusType === "idle") {
      this.setThinking(route.adminId, sessionID, false);
    }
  }

  private handleSessionIdle(properties: Record<string, unknown>): void {
    /* Explicit idle event should always hide thinking indicator. */
    const sessionID = String(properties.sessionID ?? "");
    if (!sessionID) {
      return;
    }

    const route = this.routes.resolve(sessionID);
    if (!route) {
      return;
    }

    this.setThinking(route.adminId, sessionID, false);
  }

  private setThinking(adminId: number, sessionID: string, active: boolean): void {
    /* Emit thinking start/stop only on state transitions. */
    const previous = this.thinkingActiveBySession.get(sessionID) ?? false;
    if (previous === active) {
      return;
    }

    this.thinkingActiveBySession.set(sessionID, active);
    this.outbox.enqueueThinkingControl({
      adminId,
      action: active ? "start" : "stop"
    });
  }

  private extractFileOperations(part: any): ExtractedFileOperation[] {
    /* Extract normalized file operations from tool payloads. */
    const toolName = String(part.tool ?? "");
    const state = part.state as any;
    const operations: ExtractedFileOperation[] = [];

    if (toolName === "write") {
      const targetPath = String(state?.metadata?.filepath ?? "").trim();
      if (!targetPath) {
        return operations;
      }

      const content = String(state?.input?.content ?? "");
      const additions = content.length > 0 ? content.split(/\r?\n/g).length : 0;
      const exists = Boolean(state?.metadata?.exists);
      operations.push({
        kind: exists ? "edit" : "create",
        absolutePath: targetPath,
        additions,
        deletions: 0,
        diff: String(state?.metadata?.diff ?? ""),
        before: exists ? String(state?.metadata?.before ?? "") : "",
        after: String(state?.input?.content ?? "")
      });
      return operations;
    }

    if (toolName === "edit") {
      const filediff = state?.metadata?.filediff;
      const targetPath = String(filediff?.file ?? "").trim();
      if (!targetPath) {
        return operations;
      }
      const additions = Number(filediff?.additions ?? 0) || 0;
      const deletions = Number(filediff?.deletions ?? 0) || 0;
      operations.push({
        kind: "edit",
        absolutePath: targetPath,
        additions,
        deletions,
        diff: String(filediff?.diff ?? state?.metadata?.diff ?? ""),
        before: typeof filediff?.before === "string" ? filediff.before : undefined,
        after: typeof filediff?.after === "string" ? filediff.after : undefined
      });
      return operations;
    }

    if (toolName === "apply_patch") {
      const files = Array.isArray(state?.metadata?.files) ? state.metadata.files : [];
      if (files.length === 0) {
        return operations;
      }
      files.forEach((rawFile: any) => {
        const targetPath = String(rawFile?.movePath ?? rawFile?.filePath ?? "").trim();
        if (!targetPath) {
          return;
        }

        const additions = Number(rawFile?.additions ?? 0) || 0;
        const deletions = Number(rawFile?.deletions ?? 0) || 0;
        const rawKind = String(rawFile?.type ?? "update");
        const kind: ExtractedFileOperation["kind"] =
          rawKind === "add" ? "create" : rawKind === "delete" ? "delete" : "edit";
        operations.push({
          kind,
          absolutePath: targetPath,
          additions,
          deletions,
          diff: String(rawFile?.diff ?? state?.metadata?.diff ?? ""),
          before: typeof rawFile?.before === "string" ? rawFile.before : undefined,
          after: typeof rawFile?.after === "string" ? rawFile.after : undefined
        });
      });

      return operations;
    }

    return operations;
  }

  private async emitFileOperations(
    part: any,
    route: {
      adminId: number;
      directory: string;
    }
  ): Promise<void> {
    /* Build deep-links and emit formatted HTML lines for each file operation. */
    const operations = this.extractFileOperations(part);
    for (const operation of operations) {
      const preview = this.diffPreviews.create({
        adminId: route.adminId,
        operation: operation.kind,
        absolutePath: operation.absolutePath,
        additions: operation.additions,
        deletions: operation.deletions,
        diff: operation.diff,
        before: operation.before,
        after: operation.after
      });

      const deepLink = await this.buildDiffDeepLink(preview.token);
      const text = formatFileOperationMessageHtml({
        kind: operation.kind,
        absolutePath: operation.absolutePath,
        additions: operation.additions,
        deletions: operation.deletions,
        deepLink
      });

      this.outbox.enqueueStreamNotification({
        adminId: route.adminId,
        text,
        parseMode: "HTML"
      });
    }
  }

  private async buildDiffDeepLink(token: string): Promise<string> {
    /* Prefer Telegram native deep-link to open Mini App in chat context. */
    const startParam = `${DIFF_START_PARAM_PREFIX}${token}`;
    const username = await this.resolveBotUsername();
    if (username) {
      const shortName = this.config.telegramMiniappShortName?.trim();
      if (shortName) {
        return `${TELEGRAM_DEEP_LINK_BASE}/${encodeURIComponent(username)}/${encodeURIComponent(shortName)}?startapp=${encodeURIComponent(startParam)}`;
      }

      return `${TELEGRAM_DEEP_LINK_BASE}/${encodeURIComponent(username)}?startapp=${encodeURIComponent(startParam)}`;
    }

    return `${this.config.publicBaseUrl}/miniapp/#startapp=${encodeURIComponent(startParam)}`;
  }

  private async resolveBotUsername(): Promise<string | null> {
    /* Resolve bot username once via Telegram API and cache it. */
    if (this.botUsernamePromise) {
      return this.botUsernamePromise;
    }

    this.botUsernamePromise = (async () => {
      const url = `${TELEGRAM_API_BASE_URL}/bot${this.config.telegramBotToken}/getMe`;
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }

      const body = (await response.json()) as { ok?: boolean; result?: { username?: string } };
      if (!body.ok || typeof body.result?.username !== "string" || body.result.username.trim().length === 0) {
        return null;
      }

      return body.result.username.trim();
    })().catch(() => null);

    return this.botUsernamePromise;
  }

  private handleQuestionAsked(properties: Record<string, unknown>): void {
    /* Convert OpenCode question tool prompt into Telegram inline buttons. */
    const sessionID = String(properties.sessionID ?? "");
    const requestID = String(properties.id ?? "");
    const route = this.routes.resolve(sessionID);
    if (!route || !requestID) {
      return;
    }

    /* Question pause means no active thinking spinner until user choice. */
    this.setThinking(route.adminId, sessionID, false);

    const questions = Array.isArray(properties.questions) ? properties.questions : [];
    const first = questions[0] as any;
    if (!first || typeof first.question !== "string") {
      return;
    }

    const options = Array.isArray(first.options) ? first.options.slice(0, 6) : [];
    if (options.length === 0) {
      this.outbox.enqueueStreamNotification({
        adminId: route.adminId,
        text: `Вопрос от OpenCode: ${first.question}`
      });
      return;
    }

    const token = this.routes.bindQuestion({
      requestID,
      sessionID,
      adminId: route.adminId,
      directory: route.directory,
      options: options.map((option: any) => String(option?.label ?? ""))
    });

    const keyboard = options.map((option: any, index: number) => {
      const label = String(option?.label ?? `Option ${index + 1}`);
      const callbackData = `${QUESTION_CALLBACK_PREFIX}|${token}|${index}`;
      return [{ text: label, callback_data: callbackData }];
    });

    const text = `OpenCode спрашивает:\n${String(first.question)}`;
    this.outbox.enqueueProgressReplace({
      adminId: route.adminId,
      progressKey: `question:${route.adminId}:${requestID}`,
      text,
      replyMarkup: { inlineKeyboard: keyboard }
    });
  }
}
