/**
 * @fileoverview Agent-facing Telegram media enqueue service.
 *
 * Exports:
 * - TelegramAgentMediaService - Resolves target chat/admin bindings and enqueues media delivery jobs.
 *
 * Key constructs:
 * - AgentSendMediaInput - Contract for one photo/document delivery.
 * - AgentSendAlbumInput - Contract for one multi-photo Telegram album.
 */

import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../../config/config.types";
import { OpenCodeSessionRoutingStore } from "../../open-code/opencode-session-routing.store";
import { OpenCodeClient } from "../../open-code/opencode-client";
import { ProjectsService } from "../../projects/projects.service";
import { TelegramOutboxStore } from "../outbox/telegram-outbox.store";
import { TelegramStreamStore } from "../telegram-stream.store";
import { TelegramAgentMediaStorageService } from "./telegram-agent-media-storage.service";

type AgentSendMediaInput = {
  sessionId: string;
  stagedRelativePath: string;
  sendAs: "photo" | "document";
  caption?: string;
  displayFileName?: string;
  disableNotification?: boolean;
};

type AgentSendAlbumInput = {
  sessionId: string;
  items: Array<{
    stagedRelativePath: string;
    displayFileName?: string;
  }>;
  caption?: string;
  disableNotification?: boolean;
};

type ResolvedTarget = {
  adminId: number;
  chatId: number;
};

type QueueResult = {
  adminId: number;
  chatId: number;
  itemIds: string[];
};

const MAX_ALBUM_ITEMS = 10;
const MAX_CAPTION_LENGTH = 1024;

@Injectable()
export class TelegramAgentMediaService {
  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly sessionRouting: OpenCodeSessionRoutingStore,
    private readonly projects: ProjectsService,
    private readonly opencode: OpenCodeClient,
    private readonly stream: TelegramStreamStore,
    private readonly outbox: TelegramOutboxStore,
    private readonly storage: TelegramAgentMediaStorageService
  ) {}

  public async sendMedia(input: AgentSendMediaInput): Promise<QueueResult> {
    /* Single media send supports either Telegram-compressed photo or original file-as-document. */
    const target = await this.resolveTarget(input.sessionId);
    const file = this.storage.validateStagedFile({ stagedRelativePath: input.stagedRelativePath });
    const fileName = this.resolveDisplayFileName({ explicitName: input.displayFileName, fallbackName: file.fileName });

    if (input.sendAs === "photo" && !file.isImage) {
      throw new Error(`TG_MEDIA_NOT_IMAGE: file '${fileName}' must be an image to send it as Telegram photo.`);
    }

    const item = this.outbox.enqueue({
      adminId: target.adminId,
      chatId: target.chatId,
      text: input.caption?.trim() ?? "",
      kind: "media",
      disableNotification: input.disableNotification,
      media: {
        kind: input.sendAs,
        filePath: file.absolutePath,
        fileName,
        ...(input.caption?.trim() ? { caption: this.normalizeCaption(input.caption) } : {})
      }
    });

    return {
      adminId: target.adminId,
      chatId: target.chatId,
      itemIds: [item.id]
    };
  }

  public async sendAlbum(input: AgentSendAlbumInput): Promise<QueueResult> {
    /* Telegram album delivery is limited to images and should stay in one media-group bubble. */
    const target = await this.resolveTarget(input.sessionId);
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new Error("TG_MEDIA_ALBUM_EMPTY: album must include at least one staged image.");
    }
    if (input.items.length > MAX_ALBUM_ITEMS) {
      throw new Error(`TG_MEDIA_ALBUM_TOO_LARGE: album may include at most ${MAX_ALBUM_ITEMS} images.`);
    }

    const mediaItems = input.items.map((item) => {
      const file = this.storage.validateStagedFile({ stagedRelativePath: item.stagedRelativePath });
      if (!file.isImage) {
        throw new Error(`TG_MEDIA_NOT_IMAGE: file '${file.fileName}' must be an image to include it in a Telegram album.`);
      }
      return {
        kind: "photo" as const,
        filePath: file.absolutePath,
        fileName: this.resolveDisplayFileName({ explicitName: item.displayFileName, fallbackName: file.fileName })
      };
    });

    const outboxItem = this.outbox.enqueue({
      adminId: target.adminId,
      chatId: target.chatId,
      text: input.caption?.trim() ?? "",
      kind: "media",
      disableNotification: input.disableNotification,
      media: {
        kind: "media_group",
        items: mediaItems,
        ...(input.caption?.trim() ? { caption: this.normalizeCaption(input.caption) } : {})
      }
    });

    return {
      adminId: target.adminId,
      chatId: target.chatId,
      itemIds: [outboxItem.id]
    };
  }

  public cleanupExpiredFiles(input?: { nowMs?: number }): void {
    /* Maintenance runs periodically so delivered media files do not pile up in the shared volume. */
    this.storage.pruneExpiredFiles({
      outboxItems: this.outbox.listAll(),
      nowMs: input?.nowMs
    });
  }

  private async resolveTarget(sessionId: string): Promise<ResolvedTarget> {
    /* Only the current Telegram-owned OpenCode session may define the delivery target. */
    const normalizedSessionId = String(sessionId ?? "").trim();
    if (!normalizedSessionId) {
      throw new Error("TG_MEDIA_SESSION_REQUIRED: sessionId is required for Telegram media delivery.");
    }

    const route = (await this.resolveOrRecoverRoute(normalizedSessionId)) ?? null;
    if (!route) {
      throw new Error(
        `TG_MEDIA_SESSION_UNBOUND: OpenCode session '${normalizedSessionId}' is not bound to an authenticated Telegram admin chat.`
      );
    }

    if (!this.config.adminIds.includes(route.adminId)) {
      throw new Error(`TG_MEDIA_ADMIN_UNKNOWN: admin '${route.adminId}' is not configured for Telegram delivery.`);
    }

    const binding = this.stream.get(route.adminId);
    if (!binding) {
      throw new Error(`TG_MEDIA_CHAT_UNBOUND: Telegram chat binding for admin '${route.adminId}' was not found.`);
    }

    return {
      adminId: route.adminId,
      chatId: binding.chatId
    };
  }

  private async resolveOrRecoverRoute(sessionId: string): Promise<{ adminId: number; directory: string } | null> {
    /* Recover in-memory routing after backend restarts by matching the exact currently selected session. */
    const existing = this.sessionRouting.resolve(sessionId);
    if (existing) {
      return existing;
    }

    const matches: Array<{ adminId: number; directory: string }> = [];
    for (const adminId of this.config.adminIds) {
      const active = await this.projects.getActiveProject(adminId);
      if (!active) {
        continue;
      }

      const selectedSessionId = this.opencode.getSelectedSessionID(active.rootPath);
      if (selectedSessionId !== sessionId) {
        const knownSessions = await this.opencode.listSessions({ directory: active.rootPath, limit: 50 });
        if (!knownSessions.some((session) => session.id === sessionId)) {
          continue;
        }
      }

      matches.push({ adminId, directory: active.rootPath });
    }

    /* Single-admin installations may survive active-project drift by locating the exact session across all known projects. */
    if (matches.length === 0 && this.config.adminIds.length === 1) {
      const [soleAdminId] = this.config.adminIds;
      const allProjects = await this.projects.list();
      for (const project of allProjects) {
        const knownSessions = await this.opencode.listSessions({ directory: project.rootPath, limit: 50 });
        if (!knownSessions.some((session) => session.id === sessionId)) {
          continue;
        }

        matches.push({ adminId: soleAdminId, directory: project.rootPath });
        break;
      }
    }

    if (matches.length !== 1) {
      return null;
    }

    this.sessionRouting.bind(sessionId, matches[0]);
    return matches[0];
  }

  private resolveDisplayFileName(input: { explicitName?: string; fallbackName: string }): string {
    /* Preserve human-readable names while stripping directories from agent-supplied values. */
    const candidate = input.explicitName?.trim() ? path.basename(input.explicitName.trim()) : path.basename(input.fallbackName);
    if (!candidate) {
      throw new Error("TG_MEDIA_FILENAME_INVALID: display file name must not be empty.");
    }
    return candidate;
  }

  private normalizeCaption(caption: string): string {
    /* Telegram captions are much shorter than plain messages, so fail fast instead of truncating silently. */
    const normalized = caption.trim();
    if (normalized.length > MAX_CAPTION_LENGTH) {
      throw new Error(`TG_MEDIA_CAPTION_TOO_LONG: caption exceeds the ${MAX_CAPTION_LENGTH} character Telegram limit.`);
    }
    return normalized;
  }
}
