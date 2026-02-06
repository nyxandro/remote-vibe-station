/**
 * @fileoverview Guard that validates Telegram initData for Mini App requests.
 *
 * Exports:
 * - INIT_DATA_HEADER (L15) - Header carrying Telegram initData.
 * - TelegramInitDataGuard (L17) - Ensures initData is valid and admin.
 */

import { CanActivate, ExecutionContext, Inject, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";

import { AppConfig, ConfigToken } from "../config/config.types";
import { extractUserId, verifyInitData } from "./telegram-init-data";

const INIT_DATA_HEADER = "x-telegram-init-data";

export class TelegramInitDataGuard implements CanActivate {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public canActivate(context: ExecutionContext): boolean {
    /* Extract initData from headers. */
    const request = context.switchToHttp().getRequest<Request>();
    const initData = request.headers?.[INIT_DATA_HEADER] as string | undefined;

    /*
     * Local development convenience:
     * When PUBLIC_BASE_URL points to localhost, allow requests without initData.
     * This keeps the dev stack usable before Telegram HTTPS/webhook is configured.
     */
    const isLocalPublicBaseUrl =
      this.config.publicBaseUrl.startsWith("http://localhost") ||
      this.config.publicBaseUrl.startsWith("http://127.0.0.1");

    if (!initData) {
      if (isLocalPublicBaseUrl) {
        return true;
      }
      throw new UnauthorizedException("Missing Telegram initData");
    }

    /* Verify signature and user id. */
    const isValid = verifyInitData(initData, this.config.telegramBotToken);
    if (!isValid) {
      throw new UnauthorizedException("Invalid Telegram initData");
    }

    /* Expose validated initData to downstream handlers if needed. */
    (request as any).telegramInitData = initData;

    const userId = extractUserId(initData);
    if (!userId || !this.config.adminIds.includes(userId)) {
      throw new UnauthorizedException("Access denied");
    }

    return true;
  }
}
