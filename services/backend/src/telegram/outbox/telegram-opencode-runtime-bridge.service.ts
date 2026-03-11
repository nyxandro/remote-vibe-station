/**
 * @fileoverview Live bridge for OpenCode runtime events into Telegram outbox.
 *
 * Exports:
 * - TelegramOpenCodeRuntimeBridge - Parses opencode.event and enqueues progress/questions.
 */
import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { AppConfig, ConfigToken } from "../../config/config.types";
import { EventEnvelope } from "../../events/events.types";
import { EventsService } from "../../events/events.service";
import { OpenCodeSessionRoutingStore } from "../../open-code/opencode-session-routing.store";
import { TelegramDiffPreviewStore } from "../diff-preview/telegram-diff-preview.store";
import { TelegramAssistantPartState } from "./telegram-assistant-part-state";
import { TelegramOpenCodeRuntimeFileOperations } from "./telegram-opencode-runtime-file-operations";
import { TelegramOpenCodeRuntimeInteractions } from "./telegram-opencode-runtime-interactions";
import { TelegramOutboxService } from "./telegram-outbox.service";
import { TelegramRuntimePartReplayGuard } from "./telegram-runtime-part-replay-guard";
import { extractTodoItemsFromToolPart, formatTelegramTodoProgressMessage } from "./telegram-todo-progress";
type OpenCodeBusEvent = {
  type?: string;
  properties?: Record<string, unknown>;
};
const BASH_PROGRESS_MAX_CHARS = 2600;
const BASH_PROGRESS_MIN_INTERVAL_MS = 1000;
const BASH_NOISE_PROBE_COMMAND = /^(node|npm|pnpm|yarn|bun|python|python3)\s+(-v|--version)$/i;
const COOLDOWN_MESSAGE_PATTERN = /All credentials for model[\s\S]*?(?:попытка №\d+|attempt #\d+)/gi;
const SYSTEM_REMINDER_PATTERN = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
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
  private readonly assistantTextByPart = new Map<string, string>();
  private readonly assistantTextBySession = new Map<string, string>();
  private readonly partTypeById = new Map<string, string>();
  private readonly partIdsBySession = new Map<string, Set<string>>();
  private readonly assistantPartState = new TelegramAssistantPartState();
  private readonly finalizedRuntimePartReplayGuard = new TelegramRuntimePartReplayGuard();
  private readonly thinkingActiveBySession = new Map<string, boolean>();
  private readonly emittedSystemNotificationsBySession = new Map<string, Set<string>>();
  private readonly fileOperations: TelegramOpenCodeRuntimeFileOperations;
  private readonly interactions: TelegramOpenCodeRuntimeInteractions;
  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly events: EventsService,
    private readonly routes: OpenCodeSessionRoutingStore,
    private readonly outbox: TelegramOutboxService,
    private readonly diffPreviews: TelegramDiffPreviewStore
  ) {
    this.fileOperations = new TelegramOpenCodeRuntimeFileOperations(this.config, this.diffPreviews, this.outbox);
    this.interactions = new TelegramOpenCodeRuntimeInteractions(this.routes, this.outbox, {
      setThinking: (adminId, sessionID, active) => this.setThinking(adminId, sessionID, active),
      closeAssistantStreamSegment: (sessionID) => this.closeAssistantStreamSegment(sessionID)
    });
  }
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
    const eventName = String((event.data as any)?.eventName ?? "").trim();
    if (!payload) {
      return;
    }
    let parsed: OpenCodeBusEvent;
    try {
      parsed = JSON.parse(payload) as OpenCodeBusEvent;
    } catch {
      return;
    }
    const eventType = String(parsed.type ?? eventName ?? "");
    const properties =
      parsed.properties && typeof parsed.properties === "object"
        ? (parsed.properties as Record<string, unknown>)
        : (parsed as unknown as Record<string, unknown>);
    if (eventType === "message.part.updated") {
      this.handlePartUpdated(properties);
      return;
    }

    if (eventType === "message.part.delta") {
      this.handleMessagePartDelta(properties);
      return;
    }

    if (eventType === "session.status") {
      this.handleSessionStatus(properties);
      return;
    }

    if (eventType === "session.idle") {
      this.handleSessionIdle(properties);
      return;
    }

    if (eventType === "question.asked") {
      this.handleQuestionAsked(properties);
      return;
    }

    if (eventType === "permission.updated" || eventType === "permission.asked") {
      this.handlePermissionUpdated(properties);
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
    const partID = String(part.id ?? "").trim();
    const state = part.state as any;
    const status = String(state?.status ?? "");

    /* Completed non-text parts may be replayed later; emit them into Telegram only once per session. */
    if (
      partType === "tool" &&
      partID &&
      (status === "completed" || status === "error") &&
      !this.finalizedRuntimePartReplayGuard.rememberFinalizedPart(sessionID, partID)
    ) {
      return;
    }

    if (partType === "text" && partID && !this.assistantPartState.rememberOpenTextPart(sessionID, partID)) {
      /* Late replay of an already finalized text part must not resurrect duplicate commentary. */
      return;
    }

    if (partID) {
      /* Remember part type so later delta events can distinguish text from reasoning/tool output. */
      this.partTypeById.set(partID, partType);
      const sessionPartIds = this.partIdsBySession.get(sessionID) ?? new Set<string>();
      sessionPartIds.add(partID);
      this.partIdsBySession.set(sessionID, sessionPartIds);
    }

    /* OpenCode commentary between tools should become separate Telegram text messages, not one endless edited draft. */
    if (partType !== "text") {
      this.closeAssistantStreamSegment(sessionID);
    }

    if (partType === "reasoning") {
      this.setThinking(route.adminId, sessionID, true);
    } else if (partType === "tool" || partType === "text") {
      this.setThinking(route.adminId, sessionID, false);
    }

    if (partType !== "tool") {
      return;
    }

    const toolName = String(part.tool ?? "");

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

    if (toolName === "todowrite") {
      /* Todo list updates should land as fresh chat messages so the newest checklist stays visible at the bottom. */
      if (status !== "completed") {
        return;
      }

      const todos = extractTodoItemsFromToolPart(part);
      const text = formatTelegramTodoProgressMessage(todos);
      this.outbox.enqueueAdminNotification({
        adminId: route.adminId,
        text,
        parseMode: "HTML"
      });
      return;
    }

    if (status !== "completed") {
      return;
    }

    void this.fileOperations
      .emitFromToolPart({
        part,
        adminId: route.adminId
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("[telegram-runtime-file-operations] failed to emit Telegram diff notification", {
          adminId: route.adminId,
          tool: String(part.tool ?? ""),
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  private handleMessagePartDelta(properties: Record<string, unknown>): void {
    /* Buffer only assistant text-part deltas; final plain messages are delivered via opencode.message event. */
    const sessionID = String(properties.sessionID ?? "").trim();
    if (!sessionID) {
      return;
    }

    const route = this.routes.resolve(sessionID);
    if (!route) {
      return;
    }

    const field = String(properties.field ?? "").trim();
    const partID = String(properties.partID ?? "").trim();
    if (partID && this.assistantPartState.isClosedTextPart(sessionID, partID)) {
      /* Ignore late text deltas once the corresponding Telegram reply was already finalized. */
      return;
    }

    const partType = partID ? this.partTypeById.get(partID) ?? "" : "";
    if (field !== "text" || partType !== "text") {
      return;
    }

    const delta = String(properties.delta ?? "");
    if (!delta) {
      return;
    }

    const partKey = this.buildAssistantPartKey(route.adminId, sessionID, partID);
    const nextPartText = `${this.assistantTextByPart.get(partKey) ?? ""}${delta}`;
    const sessionText = `${this.assistantTextBySession.get(sessionID) ?? ""}${delta}`;
    /* Forward important runtime/system notices even when stream mode is disabled. */
    this.enqueueSystemNotifications({ sessionID, adminId: route.adminId, text: sessionText });

    this.assistantTextByPart.set(partKey, nextPartText);
    this.assistantTextBySession.set(sessionID, sessionText);
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
      this.clearSessionRuntimeState(sessionID);
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
    this.clearSessionRuntimeState(sessionID);
  }

  private clearSessionRuntimeState(sessionID: string): void {
    /* Drop cached stream text and part metadata once the OpenCode turn is fully idle. */
    this.assistantPartState.closeOpenTextParts(sessionID);
    this.outbox.closeAssistantProgress({ sessionId: sessionID });
    this.assistantTextBySession.delete(sessionID);
    this.emittedSystemNotificationsBySession.delete(sessionID);

    const sessionPartIds = this.partIdsBySession.get(sessionID);
    if (sessionPartIds) {
      sessionPartIds.forEach((partID) => {
        this.partTypeById.delete(partID);
        for (const key of this.assistantTextByPart.keys()) {
          if (key.includes(`:${sessionID}:${partID || "part"}`)) {
            this.assistantTextByPart.delete(key);
          }
        }
      });
      this.partIdsBySession.delete(sessionID);
    }

  }

  private closeAssistantStreamSegment(sessionID: string): void {
    /* Non-text runtime activity marks a new assistant commentary block, so flush buffered text and restart. */
    this.flushAssistantCommentarySegment(sessionID);
    this.assistantPartState.closeOpenTextParts(sessionID);
    const hadBufferedText = (this.assistantTextBySession.get(sessionID) ?? "").length > 0;
    this.outbox.closeAssistantProgress({ sessionId: sessionID });
    if (!hadBufferedText) {
      return;
    }

    this.assistantTextBySession.delete(sessionID);
    for (const key of this.assistantTextByPart.keys()) {
      if (key.includes(`:${sessionID}:`)) {
        this.assistantTextByPart.delete(key);
      }
    }
  }

  private flushAssistantCommentarySegment(sessionID: string): void {
    /* Intermediate assistant text must be delivered as its own Telegram message before tools/questions continue. */
    const buffered = String(this.assistantTextBySession.get(sessionID) ?? "");
    if (!buffered.trim()) {
      return;
    }

    const route = this.routes.resolve(sessionID);
    if (!route) {
      return;
    }

    this.outbox.enqueueAssistantCommentary({
      adminId: route.adminId,
      sessionId: sessionID,
      text: buffered
    });
  }

  public finalizeAssistantReply(sessionID: string): void {
    /* The synchronous final reply is authoritative, so any later SSE replay for this turn becomes stale noise. */
    this.clearSessionRuntimeState(sessionID);
  }

  private buildAssistantPartKey(adminId: number, sessionID: string, partID: string): string {
    /* Keep part-local buffers stable even when session contains several assistant text blocks. */
    return `assistant-part:${adminId}:${sessionID}:${partID || "part"}`;
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

  private enqueueSystemNotifications(input: { sessionID: string; adminId: number; text: string }): void {
    /* Surface provider cooldowns and OpenCode system reminders in Telegram as operational notices. */
    const alreadyEmitted = this.emittedSystemNotificationsBySession.get(input.sessionID) ?? new Set<string>();
    const matches = [
      ...this.extractPatternMatches(input.text, COOLDOWN_MESSAGE_PATTERN),
      ...this.extractPatternMatches(input.text, SYSTEM_REMINDER_PATTERN)
    ];

    for (const match of matches) {
      const normalized = match.trim();
      if (!normalized || alreadyEmitted.has(normalized)) {
        continue;
      }

      this.outbox.enqueueAdminNotification({
        adminId: input.adminId,
        text: `Служебное сообщение OpenCode:\n\n${normalized}`
      });
      alreadyEmitted.add(normalized);
    }

    if (alreadyEmitted.size > 0) {
      this.emittedSystemNotificationsBySession.set(input.sessionID, alreadyEmitted);
    }
  }

  private extractPatternMatches(text: string, pattern: RegExp): string[] {
    /* Reset global regex state on every scan so repeated calls stay deterministic. */
    pattern.lastIndex = 0;
    return Array.from(text.matchAll(pattern)).map((entry) => String(entry[0] ?? ""));
  }

  private handleQuestionAsked(properties: Record<string, unknown>): void {
    /* Delegate interactive question rendering to a focused formatter. */
    this.interactions.handleQuestionAsked(properties);
  }

  private handlePermissionUpdated(properties: Record<string, unknown>): void {
    /* Delegate permission prompt rendering to a focused formatter. */
    this.interactions.handlePermissionUpdated(properties);
  }
}
