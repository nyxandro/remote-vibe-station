/**
 * @fileoverview Downloads Telegram-hosted attachments into local files for queued OpenCode prompts.
 *
 * Exports:
 * - TelegramPromptAttachmentsService (L27) - Materializes Telegram file ids into local `file://` paths.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../../config/config.types";
import { TelegramBufferedAttachment, TelegramQueuedAttachment } from "./telegram-prompt-queue.types";

const DATA_DIR = "data";
const ATTACHMENTS_DIR = "telegram-prompt-attachments";
const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_FETCH_TIMEOUT_MS = 15_000;
const OPENCODE_DATA_MOUNT_PATH = "/opencode-data";
const OPENCODE_CONTAINER_DATA_PATH = "/root/.local/share/opencode";

type TelegramGetFileResponse = {
  ok?: boolean;
  result?: { file_path?: string };
};

@Injectable()
export class TelegramPromptAttachmentsService {
  private readonly storageDir: string;

  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {
    /* Persist downloads into the shared OpenCode volume so the server container can open them via file://. */
    this.storageDir = this.resolveStorageDir();
  }

  public async materializeAttachments(input: {
    attachments: TelegramBufferedAttachment[];
  }): Promise<TelegramQueuedAttachment[]> {
    /* Download every referenced Telegram file before the prompt enters durable queue. */
    const materialized: TelegramQueuedAttachment[] = [];

    for (const attachment of input.attachments) {
      const fileInfo = await this.fetchTelegramFileInfo(attachment.telegramFileId);
      const remotePath = String(fileInfo.result?.file_path ?? "").trim();
      if (!remotePath) {
        throw new Error(`Telegram file path missing for attachment ${attachment.telegramFileId}`);
      }

      const downloadUrl = `${TELEGRAM_API_BASE}/file/bot${this.config.telegramBotToken}/${remotePath}`;
      const response = await this.fetchWithTimeout(downloadUrl, "Telegram attachment download timed out");
      if (!response.ok) {
        throw new Error(`Telegram attachment download failed: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const fileName = this.resolveFileName(attachment, remotePath);
      const targetPath = path.join(this.ensureStorageDir(), fileName);
      fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));

      materialized.push({
        id: crypto.randomUUID(),
        localPath: targetPath,
        promptUrl: `file://${path.join(OPENCODE_CONTAINER_DATA_PATH, ATTACHMENTS_DIR, fileName)}`,
        fileName,
        mimeType: attachment.mimeType ?? this.inferMimeTypeFromName(fileName),
        fileSizeBytes: typeof attachment.fileSizeBytes === "number" ? attachment.fileSizeBytes : arrayBuffer.byteLength
      });
    }

    return materialized;
  }

  public async deleteFiles(input: { attachments: TelegramQueuedAttachment[] }): Promise<void> {
    /* Cleanup temporary local files after queue item is completed or failed. */
    for (const attachment of input.attachments) {
      try {
        fs.rmSync(attachment.localPath, { force: true });
      } catch {
        /* Cleanup is best-effort; stale temp files are acceptable compared to dropping the queue. */
      }
    }
  }

  private async fetchTelegramFileInfo(fileId: string): Promise<TelegramGetFileResponse> {
    /* Resolve the stable file path via Telegram Bot API before downloading bytes. */
    const url = `${TELEGRAM_API_BASE}/bot${this.config.telegramBotToken}/getFile?file_id=${encodeURIComponent(fileId)}`;
    const response = await this.fetchWithTimeout(url, "Telegram getFile timed out");
    if (!response.ok) {
      throw new Error(`Telegram getFile failed: ${response.status}`);
    }

    const body = (await response.json()) as TelegramGetFileResponse;
    if (!body.ok) {
      throw new Error("Telegram getFile returned ok=false");
    }

    return body;
  }

  private ensureStorageDir(): string {
    /* Create temp attachment directory lazily to keep cold startup cheap. */
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    return this.storageDir;
  }

  private resolveStorageDir(): string {
    /* Prefer the shared OpenCode volume mount so file:// URLs resolve inside the OpenCode container. */
    if (fs.existsSync(OPENCODE_DATA_MOUNT_PATH)) {
      return path.join(OPENCODE_DATA_MOUNT_PATH, ATTACHMENTS_DIR);
    }

    if (this.config.opencodeDataDir) {
      return path.join(this.config.opencodeDataDir, ATTACHMENTS_DIR);
    }

    return path.join(process.cwd(), DATA_DIR, ATTACHMENTS_DIR);
  }

  private async fetchWithTimeout(url: string, timeoutMessage: string): Promise<Response> {
    /* Guard Telegram network calls so one stuck download cannot freeze the queue worker. */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TELEGRAM_FETCH_TIMEOUT_MS);

    try {
      return await fetch(url, { signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(timeoutMessage);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveFileName(attachment: TelegramBufferedAttachment, remotePath: string): string {
    /* Preserve extension hints so OpenCode and provider-side vision models get correct MIME context. */
    const sourceName = attachment.fileName?.trim() || path.basename(remotePath).trim();
    const extension = path.extname(sourceName) || this.defaultExtensionForMime(attachment.mimeType);
    return `${crypto.randomUUID()}${extension}`;
  }

  private defaultExtensionForMime(mimeType: string | null): string {
    /* Map supported Telegram MIME types to deterministic file extensions when filename is absent. */
    if (mimeType === "application/pdf") {
      return ".pdf";
    }
    if (mimeType === "image/png") {
      return ".png";
    }
    if (mimeType === "image/webp") {
      return ".webp";
    }
    return ".jpg";
  }

  private inferMimeTypeFromName(fileName: string): string {
    /* Use filename extension only when Telegram omitted MIME metadata. */
    const extension = path.extname(fileName).toLowerCase();
    if (extension === ".pdf") {
      return "application/pdf";
    }
    if (extension === ".png") {
      return "image/png";
    }
    if (extension === ".webp") {
      return "image/webp";
    }
    return "image/jpeg";
  }
}
