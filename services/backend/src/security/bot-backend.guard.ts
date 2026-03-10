/**
 * @fileoverview Guard that validates the shared bot/backend token for trusted internal callers.
 *
 * Exports:
 * - BOT_BACKEND_TOKEN_HEADER - Header carrying the shared bot/backend secret.
 * - BotBackendGuard - Protects internal backend APIs that do not require Telegram admin initData.
 */

import * as crypto from "node:crypto";

import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";

import { AppConfig, ConfigToken } from "../config/config.types";

export const BOT_BACKEND_TOKEN_HEADER = "x-bot-backend-token";

@Injectable()
export class BotBackendGuard implements CanActivate {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public canActivate(context: ExecutionContext): boolean {
    /* Only trusted backend/opencode containers may mint short-lived git credentials. */
    const request = context.switchToHttp().getRequest<Request>();
    const tokenHeader = request.headers?.[BOT_BACKEND_TOKEN_HEADER];
    const sharedToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    if (!sharedToken) {
      throw new UnauthorizedException("Missing bot backend token");
    }

    const configuredToken = String(this.config.botBackendAuthToken ?? "").trim();
    if (!configuredToken) {
      throw new UnauthorizedException("Bot backend token is not configured");
    }

    const received = Buffer.from(sharedToken, "utf-8");
    const expected = Buffer.from(configuredToken, "utf-8");
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      throw new UnauthorizedException("Invalid bot backend token");
    }

    return true;
  }
}
