/**
 * @fileoverview Question and permission formatter for OpenCode runtime events.
 *
 * Exports:
 * - TelegramOpenCodeRuntimeInteractions - Converts interactive runtime requests into Telegram buttons.
 */

import { OpenCodeSessionRoutingStore } from "../../open-code/opencode-session-routing.store";
import { formatTelegramQuestionPrompt } from "../telegram-question-prompt";
import { TelegramOutboxService } from "./telegram-outbox.service";

type InteractionControls = {
  setThinking: (adminId: number, sessionID: string, active: boolean) => void;
  closeAssistantStreamSegment: (sessionID: string) => void;
};

type NormalizedPermissionPayload = {
  permissionID: string;
  sessionID: string;
  status: "pending" | "resolved";
  title: string | null;
  tool: string | null;
  target: string | null;
};

const QUESTION_CALLBACK_PREFIX = "q";
const PERMISSION_CALLBACK_PREFIX = "perm";

export class TelegramOpenCodeRuntimeInteractions {
  public constructor(
    private readonly routes: OpenCodeSessionRoutingStore,
    private readonly outbox: TelegramOutboxService,
    private readonly controls: InteractionControls
  ) {}

  public handleQuestionAsked(properties: Record<string, unknown>): void {
    /* Convert OpenCode question prompts into Telegram inline keyboards. */
    const sessionID = String(properties.sessionID ?? "");
    const requestID = String(properties.id ?? "");
    const route = this.routes.resolve(sessionID);
    if (!route || !requestID) {
      return;
    }

    /* Question pause means no active thinking spinner until the user answers. */
    this.controls.setThinking(route.adminId, sessionID, false);
    this.controls.closeAssistantStreamSegment(sessionID);

    const questions = Array.isArray(properties.questions)
      ? properties.questions
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
          .map((item) => ({
            header: String(item.header ?? "Question"),
            question: String(item.question ?? ""),
            options: Array.isArray(item.options)
              ? item.options
                  .filter((option): option is Record<string, unknown> => Boolean(option && typeof option === "object"))
                  .map((option) => String(option.label ?? "").trim())
                  .filter((label) => label.length > 0)
              : [],
            multiple: Boolean(item.multiple)
          }))
          .filter((item) => item.question.trim().length > 0)
      : [];
    const first = questions[0];
    if (!first) {
      return;
    }

    const options = Array.isArray(first.options) ? first.options : [];
    if (options.length === 0) {
      /* Free-text OpenCode questions are not actionable from Telegram buttons, so surface a clear fallback instruction. */
      this.outbox.enqueueAdminNotification({
        adminId: route.adminId,
        text:
          `${formatTelegramQuestionPrompt({
            header: first.header,
            question: first.question,
            index: 1,
            total: questions.length
          })}\n\n` +
          "Свободный ответ в Telegram пока не поддержан. Ответь через OpenCode UI или Mini App."
      });
      return;
    }

    /* Question tokens are fixed 16-hex chars, so callback_data stays far below Telegram's 64-byte limit. */
    const token = this.routes.bindQuestion({
      requestID,
      sessionID,
      adminId: route.adminId,
      directory: route.directory,
      questions
    });

    const keyboard = options.map((label, index) => [{
      text: label,
      callback_data: `${QUESTION_CALLBACK_PREFIX}|${token}|0|${index}`
    }]);

    this.outbox.enqueueProgressReplace({
      adminId: route.adminId,
      progressKey: `question:${route.adminId}:${requestID}`,
      text: formatTelegramQuestionPrompt({
        header: first.header,
        question: first.question,
        index: 1,
        total: questions.length
      }),
      replyMarkup: { inlineKeyboard: keyboard }
    });
  }

  public handlePermissionUpdated(properties: Record<string, unknown>): void {
    /* Convert pending permission prompts into Telegram approval buttons. */
    const normalized = this.normalizePermissionPayload(properties);
    if (!normalized || normalized.status !== "pending") {
      return;
    }

    const route = this.routes.resolve(normalized.sessionID);
    if (!route) {
      // eslint-disable-next-line no-console
      console.error(`[telegram-permission] route missing for session=${normalized.sessionID}; permission message not delivered`);
      return;
    }

    /* Permission pause also ends the current thinking/stream segment until the user chooses. */
    this.controls.setThinking(route.adminId, normalized.sessionID, false);
    this.controls.closeAssistantStreamSegment(normalized.sessionID);

    const routeID = `${normalized.sessionID}:${normalized.permissionID}`;
    const token = this.routes.bindPermission({
      routeID,
      sessionID: normalized.sessionID,
      adminId: route.adminId,
      directory: route.directory,
      permissionID: normalized.permissionID
    });

    const keyboard = [
      [
        { text: "Разрешить один раз", callback_data: `${PERMISSION_CALLBACK_PREFIX}|${token}|once` },
        { text: "Всегда разрешать", callback_data: `${PERMISSION_CALLBACK_PREFIX}|${token}|always` }
      ],
      [{ text: "Отклонить", callback_data: `${PERMISSION_CALLBACK_PREFIX}|${token}|reject` }]
    ];

    const detailParts = [
      normalized.tool ? `tool=${normalized.tool}` : null,
      normalized.target ? `target=${normalized.target}` : null
    ].filter((item): item is string => Boolean(item));
    const details = detailParts.length > 0 ? `\n${detailParts.join(" | ")}` : "";
    const title = normalized.title ?? "OpenCode запрашивает подтверждение на выполнение действия.";

    this.outbox.enqueueProgressReplace({
      adminId: route.adminId,
      progressKey: `permission:${route.adminId}:${normalized.permissionID}`,
      text: `OpenCode запрашивает права:\n${title}${details}`,
      replyMarkup: { inlineKeyboard: keyboard }
    });
  }

  private normalizePermissionPayload(properties: Record<string, unknown>): NormalizedPermissionPayload | null {
    /* Handle both flat and nested permission payloads emitted by different OpenCode runtime versions. */
    const nestedPermission = properties.permission;
    const permission =
      nestedPermission && typeof nestedPermission === "object"
        ? (nestedPermission as Record<string, unknown>)
        : properties;
    const permissionID = String(permission.id ?? properties.permissionID ?? "").trim();
    const sessionID = String(permission.sessionID ?? properties.sessionID ?? "").trim();
    if (!permissionID || !sessionID) {
      return null;
    }

    const statusRaw = String(permission.status ?? properties.status ?? "pending").trim().toLowerCase();
    const status: "pending" | "resolved" =
      statusRaw === "pending" || statusRaw === "ask" || statusRaw === "requested" ? "pending" : "resolved";

    const rawMetadata = permission.metadata;
    const metadata =
      rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
        ? (rawMetadata as Record<string, unknown>)
        : {};
    const titleRaw = permission.title ?? permission.message ?? metadata.title;
    const toolRaw = metadata.tool ?? permission.tool;
    const targetRaw = metadata.path ?? metadata.filepath ?? metadata.target ?? permission.path;

    return {
      permissionID,
      sessionID,
      status,
      title: typeof titleRaw === "string" && titleRaw.trim().length > 0 ? titleRaw.trim() : null,
      tool: typeof toolRaw === "string" && toolRaw.trim().length > 0 ? toolRaw.trim() : null,
      target: typeof targetRaw === "string" && targetRaw.trim().length > 0 ? targetRaw.trim() : null
    };
  }
}
