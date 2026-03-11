/**
 * @fileoverview File-operation formatter for OpenCode runtime events.
 *
 * Exports:
 * - TelegramOpenCodeRuntimeFileOperations - Converts tool payloads into Telegram diff notifications.
 */

import { AppConfig } from "../../config/config.types";
import { TelegramDiffPreviewStore } from "../diff-preview/telegram-diff-preview.store";
import { formatFileOperationMessageHtml } from "./telegram-file-event-message";
import { TelegramOutboxService } from "./telegram-outbox.service";

type ExtractedFileOperation = {
  kind: "create" | "edit" | "delete";
  absolutePath: string;
  additions: number;
  deletions: number;
  diff: string;
  before?: string;
  after?: string;
};

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_DEEP_LINK_BASE = "https://t.me";
const DIFF_START_PARAM_PREFIX = "diff_";

const countUnifiedDiffChanges = (diff: string): { additions: number; deletions: number } | null => {
  /* Reuse unified diff metadata when available so edit notifications reflect actual changed lines. */
  if (!diff.trim()) {
    return null;
  }

  let additions = 0;
  let deletions = 0;
  for (const line of diff.split(/\r?\n/g)) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
};

export class TelegramOpenCodeRuntimeFileOperations {
  private botUsernamePromise: Promise<string | null> | null = null;

  public constructor(
    private readonly config: AppConfig,
    private readonly diffPreviews: TelegramDiffPreviewStore,
    private readonly outbox: TelegramOutboxService
  ) {}

  public async emitFromToolPart(input: {
    part: any;
    adminId: number;
  }): Promise<void> {
    /* Build deep-links and emit formatted HTML lines for each detected file operation. */
    const operations = this.extractFileOperations(input.part);
    for (const operation of operations) {
      const preview = this.diffPreviews.create({
        adminId: input.adminId,
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
        adminId: input.adminId,
        text,
        parseMode: "HTML"
      });
    }
  }

  private extractFileOperations(part: any): ExtractedFileOperation[] {
    /* Normalize tool-specific payloads into one compact file-operation shape. */
    const toolName = String(part.tool ?? "");
    const state = part.state as any;
    const operations: ExtractedFileOperation[] = [];

    if (toolName === "write") {
      const targetPath = String(state?.metadata?.filepath ?? "").trim();
      if (!targetPath) {
        return operations;
      }

      const content = String(state?.input?.content ?? "");
      const diff = String(state?.metadata?.diff ?? "");
      const exists = Boolean(state?.metadata?.exists);
      const lineChanges = exists ? countUnifiedDiffChanges(diff) : null;
      const additions = lineChanges?.additions ?? (content.length > 0 ? content.split(/\r?\n/g).length : 0);
      const deletions = lineChanges?.deletions ?? 0;
      operations.push({
        kind: exists ? "edit" : "create",
        absolutePath: targetPath,
        additions,
        deletions,
        diff,
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

      operations.push({
        kind: "edit",
        absolutePath: targetPath,
        additions: Number(filediff?.additions ?? 0) || 0,
        deletions: Number(filediff?.deletions ?? 0) || 0,
        diff: String(filediff?.diff ?? state?.metadata?.diff ?? ""),
        before: typeof filediff?.before === "string" ? filediff.before : undefined,
        after: typeof filediff?.after === "string" ? filediff.after : undefined
      });
      return operations;
    }

    if (toolName === "apply_patch") {
      const files = Array.isArray(state?.metadata?.files) ? state.metadata.files : [];
      for (const rawFile of files) {
        const targetPath = String(rawFile?.movePath ?? rawFile?.filePath ?? "").trim();
        if (!targetPath) {
          continue;
        }

        const rawKind = String(rawFile?.type ?? "update");
        operations.push({
          kind: rawKind === "add" ? "create" : rawKind === "delete" ? "delete" : "edit",
          absolutePath: targetPath,
          additions: Number(rawFile?.additions ?? 0) || 0,
          deletions: Number(rawFile?.deletions ?? 0) || 0,
          diff: String(rawFile?.diff ?? state?.metadata?.diff ?? ""),
          before: typeof rawFile?.before === "string" ? rawFile.before : undefined,
          after: typeof rawFile?.after === "string" ? rawFile.after : undefined
        });
      }
    }

    return operations;
  }

  private async buildDiffDeepLink(token: string): Promise<string> {
    /* Prefer Telegram native deep-links so diff previews reopen inside the bot chat context. */
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
    /* Resolve bot username once so repeated file edits do not spam Telegram getMe requests. */
    if (this.botUsernamePromise) {
      return this.botUsernamePromise;
    }

    const usernameRequest = (async () => {
      const url = `${TELEGRAM_API_BASE_URL}/bot${this.config.telegramBotToken}/getMe`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Telegram getMe failed with status ${response.status}`);
      }

      const body = (await response.json()) as { ok?: boolean; result?: { username?: string } };
      if (!body.ok || typeof body.result?.username !== "string" || body.result.username.trim().length === 0) {
        throw new Error("Telegram getMe returned no username");
      }

      return body.result.username.trim();
    })().catch((error) => {
      this.botUsernamePromise = null;
      // eslint-disable-next-line no-console
      console.error("[telegram-runtime-file-operations] failed to resolve bot username", {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    });

    this.botUsernamePromise = usernameRequest;
    return usernameRequest;
  }
}
