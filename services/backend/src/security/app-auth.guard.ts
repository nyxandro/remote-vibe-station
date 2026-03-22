/**
 * @fileoverview Combined auth guard for Telegram Mini App and web browser access.
 *
 * Accepts one of:
 * - Telegram initData header (x-telegram-init-data)
 * - Authorization: Bearer <web-token>
 *
 * Exports:
 * - AppAuthGuard (L25) - Guard used by Mini App controllers.
 */

import { CanActivate, ExecutionContext, Inject, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";

import { AppConfig, ConfigToken } from "../config/config.types";
import { createAppErrorBody } from "../logging/app-error";
import { isUnsafeLocalRequestAllowed } from "./local-dev-auth";
import { extractUserId, verifyInitData } from "./telegram-init-data";
import { verifyWebToken } from "./web-token";

const INIT_DATA_HEADER = "x-telegram-init-data";

export class AppAuthGuard implements CanActivate {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public canActivate(context: ExecutionContext): boolean {
    /* Authenticate request with Telegram or web token. */
    const request = context.switchToHttp().getRequest<Request>();

    const initData = request.headers?.[INIT_DATA_HEADER] as string | undefined;
    if (initData) {
      return this.authorizeTelegram(request, initData);
    }

    const bearer = request.headers?.authorization;
    if (bearer) {
      return this.authorizeWebToken(request, bearer);
    }

    /*
      * Local dev bypass is intentionally opt-in because these endpoints are admin-capable.
     *
     * Important:
     * - Some endpoints (Telegram stream status/start/stop) require admin identity.
     * - In localhost mode we can derive identity only when there is exactly one admin.
     * - If multiple admins are configured, we allow browsing but identity-dependent
     *   endpoints will fail fast.
     */
    if (isUnsafeLocalRequestAllowed({ request, config: this.config })) {
      if ((request as any).authAdminId == null && this.config.adminIds.length === 1) {
        (request as any).authAdminId = this.config.adminIds[0];
      }
      return true;
    }

    throw new UnauthorizedException(
      createAppErrorBody({
        code: "APP_AUTH_REQUIRED",
        message: "Authentication is missing or invalid.",
        hint: "Provide Telegram initData or a valid browser token and retry."
      })
    );
  }

  private authorizeTelegram(request: Request, initData: string): boolean {
    /* Validate Telegram initData signature and admin id. */
    const isValid = verifyInitData(initData, this.config.telegramBotToken);
    if (!isValid) {
      throw new UnauthorizedException(
        createAppErrorBody({
          code: "APP_TELEGRAM_INIT_DATA_INVALID",
          message: "Telegram initData signature is invalid.",
          hint: "Reopen the Mini App from Telegram and retry."
        })
      );
    }

    const userId = extractUserId(initData);
    if (!userId || !this.config.adminIds.includes(userId)) {
      throw new UnauthorizedException(
        createAppErrorBody({
          code: "APP_ACCESS_DENIED",
          message: "This admin account is not allowed to use the backend.",
          hint: "Sign in with an allowed admin account or update ADMIN_IDS."
        })
      );
    }

    (request as any).telegramInitData = initData;
    (request as any).authAdminId = userId;
    return true;
  }

  private authorizeWebToken(request: Request, authorization: string): boolean {
    /* Validate signed web token (browser access). */
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new UnauthorizedException(
        createAppErrorBody({
          code: "APP_AUTH_HEADER_INVALID",
          message: "Authorization header must use Bearer token format.",
          hint: "Send 'Authorization: Bearer <token>' and retry."
        })
      );
    }

    const token = match[1];
    const verified = verifyWebToken({ token, botToken: this.config.telegramBotToken });
    if (!verified) {
      throw new UnauthorizedException(
        createAppErrorBody({
          code: "APP_WEB_TOKEN_INVALID",
          message: "Browser access token is invalid or expired.",
          hint: "Open the Mini App again to refresh the browser token."
        })
      );
    }

    if (!this.config.adminIds.includes(verified.adminId)) {
      throw new UnauthorizedException(
        createAppErrorBody({
          code: "APP_ACCESS_DENIED",
          message: "This admin account is not allowed to use the backend.",
          hint: "Sign in with an allowed admin account or update ADMIN_IDS."
        })
      );
    }

    (request as any).authAdminId = verified.adminId;
    return true;
  }
}
