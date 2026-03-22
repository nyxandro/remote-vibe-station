/**
 * @fileoverview Browser bearer-token refresh endpoint for Mini App deep links.
 *
 * Exports:
 * - WebTokenController - Issues and renews signed browser tokens for Mini App/browser sessions.
 */

import { BadRequestException, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { AppConfig, ConfigToken } from "../config/config.types";
import { createAppErrorBody } from "../logging/app-error";
import { AppAuthGuard } from "./app-auth.guard";
import { createWebToken, getWebTokenTtlMs } from "./web-token";

type AuthenticatedRequest = Request & {
  authAdminId?: number;
};

@Controller("api/auth/web-token")
@UseGuards(AppAuthGuard)
export class WebTokenController {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  @Post("bootstrap")
  public bootstrap(@Req() request: AuthenticatedRequest): { token: string; expiresAt: string } {
    /* Telegram-hosted Mini App sessions exchange initData into the same sliding bearer token used by browser links. */
    const adminId = request.authAdminId;
    const initData = request.headers?.["x-telegram-init-data"];
    if (typeof adminId !== "number" || typeof initData !== "string" || initData.trim().length === 0) {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_WEB_TOKEN_BOOTSTRAP_INIT_DATA_REQUIRED",
          message: "Telegram Mini App token bootstrap requires valid initData.",
          hint: "Open the Mini App from Telegram and retry the request."
        })
      );
    }

    /* Newly minted bearer token keeps Telegram-authenticated identity but survives initData freshness window expiry. */
    return this.issueToken(adminId);
  }

  @Post("refresh")
  public refresh(@Req() request: AuthenticatedRequest): { token: string; expiresAt: string } {
    /* Refresh only works for an existing browser bearer-token flow, not Telegram initData or localhost bypass. */
    const adminId = request.authAdminId;
    const authorization = request.headers?.authorization;
    if (typeof adminId !== "number" || typeof authorization !== "string" || authorization.trim().length === 0) {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_WEB_TOKEN_REFRESH_AUTH_REQUIRED",
          message: "Browser token refresh requires an existing Bearer token.",
          hint: "Keep the current browser session open, or reopen the Mini App to start a new one."
        })
      );
    }

    /* Browser refresh keeps the same admin identity, but pushes expiry forward for the active browser session. */
    return this.issueToken(adminId);
  }

  private issueToken(adminId: number): { token: string; expiresAt: string } {
    /* One issuer keeps bootstrap and refresh flows aligned on identical TTL/signing rules. */
    const nowMs = Date.now();
    return {
      token: createWebToken({
        adminId,
        botToken: this.config.telegramBotToken,
        nowMs
      }),
      expiresAt: new Date(nowMs + getWebTokenTtlMs()).toISOString()
    };
  }
}
