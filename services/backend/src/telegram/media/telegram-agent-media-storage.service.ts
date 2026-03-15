/**
 * @fileoverview Shared filesystem policy for Telegram agent media exchange.
 *
 * Exports:
 * - AGENT_SHARE_DIR_NAME - Top-level shared directory inside OpenCode data volume.
 * - AGENT_SHARE_OUTGOING_DIR_NAME - Outgoing subdirectory used for staged agent files.
 * - TelegramAgentMediaStorageService - Resolves staged paths, validates files, and prunes expired artifacts.
 *
 * Key constructs:
 * - MAX_TELEGRAM_MEDIA_BYTES - Conservative per-file limit for Telegram media delivery.
 * - DELIVERED_FILE_RETENTION_MS - Grace window before deleting successfully delivered media.
 * - DEAD_FILE_RETENTION_MS - Longer grace window for failed/dead media for diagnostics.
 * - ORPHAN_FILE_RETENTION_MS - TTL for files no longer referenced by the outbox.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../../config/config.types";
import { TelegramOutboxItem, TelegramOutboxMediaDescriptor } from "../outbox/telegram-outbox.types";

const BACKEND_OPENCODE_DATA_MOUNT_PATH = "/opencode-data";
export const AGENT_SHARE_DIR_NAME = "agent-share";
export const AGENT_SHARE_OUTGOING_DIR_NAME = "outgoing";
const DATA_DIR = "data";
const MAX_TELEGRAM_MEDIA_BYTES = 45 * 1024 * 1024;
const DELIVERED_FILE_RETENTION_MS = 10 * 60_000;
const DEAD_FILE_RETENTION_MS = 24 * 60 * 60_000;
const ORPHAN_FILE_RETENTION_MS = 24 * 60 * 60_000;

type ValidatedStagedFile = {
  absolutePath: string;
  fileName: string;
  sizeBytes: number;
  isImage: boolean;
};

@Injectable()
export class TelegramAgentMediaStorageService {
  private readonly outgoingRoot: string;

  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {
    /* Keep one deterministic shared directory that both backend and OpenCode can access. */
    this.outgoingRoot = this.resolveOutgoingRoot();
  }

  public ensureOutgoingRoot(): string {
    /* Tool-driven staging may hit a fresh volume, so create the folder lazily. */
    if (!fs.existsSync(this.outgoingRoot)) {
      fs.mkdirSync(this.outgoingRoot, { recursive: true });
    }
    return this.outgoingRoot;
  }

  public getOutgoingRoot(): string {
    /* Expose the resolved path for diagnostics and API responses. */
    return this.ensureOutgoingRoot();
  }

  public validateStagedFile(input: { stagedRelativePath: string }): ValidatedStagedFile {
    /* Accept only files already staged inside the managed outgoing directory. */
    const absolutePath = this.resolveStagedAbsolutePath(input.stagedRelativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(
        `TG_MEDIA_FILE_NOT_FOUND: staged file '${input.stagedRelativePath}' was not found in the Telegram agent share directory.`
      );
    }

    const realPath = fs.realpathSync(absolutePath);
    const outgoingRootRealPath = fs.realpathSync(this.ensureOutgoingRoot());
    const outgoingRootWithSeparator = `${outgoingRootRealPath}${path.sep}`;
    if (realPath !== outgoingRootRealPath && !realPath.startsWith(outgoingRootWithSeparator)) {
      throw new Error(
        `TG_MEDIA_INVALID_PATH: staged file '${input.stagedRelativePath}' must stay inside the managed Telegram agent share directory.`
      );
    }

    const stats = fs.statSync(realPath);
    if (!stats.isFile()) {
      throw new Error(
        `TG_MEDIA_INVALID_FILE: staged path '${input.stagedRelativePath}' must point to a regular file.`
      );
    }
    if (stats.size <= 0) {
      throw new Error(`TG_MEDIA_EMPTY_FILE: staged file '${input.stagedRelativePath}' is empty.`);
    }
    if (stats.size > MAX_TELEGRAM_MEDIA_BYTES) {
      throw new Error(
        `TG_MEDIA_FILE_TOO_LARGE: staged file '${input.stagedRelativePath}' exceeds the ${MAX_TELEGRAM_MEDIA_BYTES} byte media limit.`
      );
    }

    const fileName = path.basename(realPath);
    return {
      absolutePath: realPath,
      fileName,
      sizeBytes: stats.size,
      isImage: this.isImageExtension(fileName)
    };
  }

  public pruneExpiredFiles(input: { outboxItems: TelegramOutboxItem[]; nowMs?: number }): void {
    /* Best-effort sweep keeps the shared folder bounded without racing active pending sends. */
    const root = this.ensureOutgoingRoot();
    const nowMs = input.nowMs ?? Date.now();
    const references = this.collectReferences(input.outboxItems);

    for (const name of fs.readdirSync(root)) {
      const absolutePath = path.join(root, name);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(absolutePath);
      } catch {
        continue;
      }

      if (!stats.isFile()) {
        continue;
      }

      const reference = references.get(absolutePath);
      if (!reference) {
        if (nowMs - stats.mtimeMs >= ORPHAN_FILE_RETENTION_MS) {
          this.removeFile(absolutePath);
        }
        continue;
      }

      if (reference.hasPending) {
        continue;
      }

      if (reference.latestDeliveredAtMs > 0 && nowMs - reference.latestDeliveredAtMs >= DELIVERED_FILE_RETENTION_MS) {
        this.removeFile(absolutePath);
        continue;
      }

      if (reference.latestDeadAtMs > 0 && nowMs - reference.latestDeadAtMs >= DEAD_FILE_RETENTION_MS) {
        this.removeFile(absolutePath);
      }
    }
  }

  private resolveOutgoingRoot(): string {
    /* Prefer the shared OpenCode data volume so files stay visible to both containers. */
    if (fs.existsSync(BACKEND_OPENCODE_DATA_MOUNT_PATH)) {
      return path.join(BACKEND_OPENCODE_DATA_MOUNT_PATH, AGENT_SHARE_DIR_NAME, AGENT_SHARE_OUTGOING_DIR_NAME);
    }
    if (this.config.opencodeDataDir) {
      return path.join(this.config.opencodeDataDir, AGENT_SHARE_DIR_NAME, AGENT_SHARE_OUTGOING_DIR_NAME);
    }
    return path.join(process.cwd(), DATA_DIR, AGENT_SHARE_DIR_NAME, AGENT_SHARE_OUTGOING_DIR_NAME);
  }

  private resolveStagedAbsolutePath(stagedRelativePath: string): string {
    /* Reject absolute paths and traversal so agents cannot smuggle arbitrary host files into delivery. */
    const candidate = String(stagedRelativePath ?? "").trim();
    if (!candidate) {
      throw new Error("TG_MEDIA_PATH_REQUIRED: stagedRelativePath is required.");
    }
    if (path.isAbsolute(candidate)) {
      throw new Error("TG_MEDIA_INVALID_PATH: stagedRelativePath must be relative to the managed Telegram share directory.");
    }

    const resolved = path.resolve(this.ensureOutgoingRoot(), candidate);
    const rootWithSeparator = `${this.ensureOutgoingRoot()}${path.sep}`;
    if (resolved !== this.ensureOutgoingRoot() && !resolved.startsWith(rootWithSeparator)) {
      throw new Error(
        `TG_MEDIA_INVALID_PATH: staged path '${candidate}' escapes the managed Telegram share directory.`
      );
    }
    return resolved;
  }

  private collectReferences(items: TelegramOutboxItem[]): Map<string, { hasPending: boolean; latestDeliveredAtMs: number; latestDeadAtMs: number }> {
    /* One reference map lets cleanup reason about pending, delivered, and dead terminal states per file. */
    const references = new Map<string, { hasPending: boolean; latestDeliveredAtMs: number; latestDeadAtMs: number }>();

    for (const item of items) {
      const paths = this.extractMediaPaths(item.media);
      if (paths.length === 0) {
        continue;
      }

      for (const absolutePath of paths) {
        const record = references.get(absolutePath) ?? {
          hasPending: false,
          latestDeliveredAtMs: 0,
          latestDeadAtMs: 0
        };

        if (item.status === "pending") {
          record.hasPending = true;
        }
        if (item.status === "delivered") {
          record.latestDeliveredAtMs = Math.max(record.latestDeliveredAtMs, Date.parse(item.deliveredAt ?? "") || 0);
        }
        if (item.status === "dead") {
          record.latestDeadAtMs = Math.max(record.latestDeadAtMs, Date.parse(item.deadAt ?? "") || 0);
        }

        references.set(absolutePath, record);
      }
    }

    return references;
  }

  private extractMediaPaths(media?: TelegramOutboxMediaDescriptor): string[] {
    /* Cleanup only cares about persisted file paths, regardless of Telegram send mode. */
    if (!media) {
      return [];
    }
    if (media.kind === "media_group") {
      return media.items.map((item) => item.filePath);
    }
    return [media.filePath];
  }

  private isImageExtension(fileName: string): boolean {
    /* Use extension-based gating because staged filenames intentionally preserve source suffixes. */
    const extension = path.extname(fileName).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension);
  }

  private removeFile(filePath: string): void {
    /* Cleanup must never crash maintenance if one file vanished or became unreadable. */
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      /* Ignore best-effort cleanup failures. */
    }
  }
}
