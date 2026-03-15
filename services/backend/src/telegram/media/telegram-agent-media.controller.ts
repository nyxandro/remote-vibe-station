/**
 * @fileoverview Internal agent-facing endpoints for Telegram media delivery.
 *
 * Exports:
 * - TelegramAgentMediaController - Accepts trusted tool requests and enqueues photo/document/album delivery.
 */

import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";

import { BotBackendGuard } from "../../security/bot-backend.guard";
import { TelegramAgentMediaService } from "./telegram-agent-media.service";

@Controller("api/telegram/agent-media")
export class TelegramAgentMediaController {
  public constructor(private readonly media: TelegramAgentMediaService) {}

  @UseGuards(BotBackendGuard)
  @Post("send")
  public send(
    @Body()
    body: {
      sessionId?: string;
      stagedRelativePath?: string;
      sendAs?: "photo" | "document";
      caption?: string;
      displayFileName?: string;
      disableNotification?: boolean;
    }
  ) {
    /* Validate required fields at the boundary so tool failures stay readable to the agent. */
    if (!body?.sessionId || typeof body.sessionId !== "string") {
      throw new BadRequestException(
        "TG_MEDIA_SESSION_REQUIRED: sessionId is required and must be bound to the authenticated Telegram chat context."
      );
    }
    if (!body?.stagedRelativePath || typeof body.stagedRelativePath !== "string") {
      throw new BadRequestException(
        "TG_MEDIA_PATH_REQUIRED: stagedRelativePath is required and must point to a file inside the Telegram agent share directory."
      );
    }
    if (body.sendAs !== "photo" && body.sendAs !== "document") {
      throw new BadRequestException("TG_MEDIA_SEND_MODE_INVALID: sendAs must be either 'photo' or 'document'.");
    }

    try {
      return this.media.sendMedia({
        sessionId: body.sessionId,
        stagedRelativePath: body.stagedRelativePath,
        sendAs: body.sendAs,
        caption: body.caption,
        displayFileName: body.displayFileName,
        disableNotification: body.disableNotification
      });
    } catch (error) {
      throw this.rethrowAsBadRequest(error);
    }
  }

  @UseGuards(BotBackendGuard)
  @Post("send-album")
  public sendAlbum(
    @Body()
    body: {
      sessionId?: string;
      items?: Array<{ stagedRelativePath?: string; displayFileName?: string }>;
      caption?: string;
      disableNotification?: boolean;
    }
  ) {
    /* Albums require at least one staged image descriptor. */
    if (!body?.sessionId || typeof body.sessionId !== "string") {
      throw new BadRequestException(
        "TG_MEDIA_SESSION_REQUIRED: sessionId is required and must be bound to the authenticated Telegram chat context."
      );
    }
    if (!Array.isArray(body?.items) || body.items.length === 0) {
      throw new BadRequestException("TG_MEDIA_ALBUM_EMPTY: items must contain at least one staged image.");
    }

    const normalizedItems = body.items.map((item) => {
      if (!item?.stagedRelativePath || typeof item.stagedRelativePath !== "string") {
        throw new BadRequestException(
          "TG_MEDIA_PATH_REQUIRED: every album item must include stagedRelativePath inside the Telegram agent share directory."
        );
      }
      return {
        stagedRelativePath: item.stagedRelativePath,
        displayFileName: item.displayFileName
      };
    });

    try {
      return this.media.sendAlbum({
        sessionId: body.sessionId,
        items: normalizedItems,
        caption: body.caption,
        disableNotification: body.disableNotification
      });
    } catch (error) {
      throw this.rethrowAsBadRequest(error);
    }
  }

  private rethrowAsBadRequest(error: unknown): BadRequestException {
    /* Internal tool callers need validation failures as 400s, not generic 500s. */
    const message = error instanceof Error ? error.message : String(error);
    return new BadRequestException(message);
  }
}
