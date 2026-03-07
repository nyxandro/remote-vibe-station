/**
 * @fileoverview Guard that validates admin id header.
 *
 * Exports:
 * - ADMIN_ID_HEADER (L14) - Header carrying admin id.
 * - BOT_BACKEND_TOKEN_HEADER (L15) - Header carrying bot/backend shared secret.
 * - AdminHeaderGuard (L17) - Ensures x-admin-id belongs to admins and caller knows shared secret.
 */

import * as crypto from "node:crypto";

import { CanActivate, ExecutionContext, Inject, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";

import { AppConfig, ConfigToken } from "../config/config.types";

export const ADMIN_ID_HEADER = "x-admin-id";
export const BOT_BACKEND_TOKEN_HEADER = "x-bot-backend-token";

export class AdminHeaderGuard implements CanActivate {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public canActivate(context: ExecutionContext): boolean {
    /* Require shared secret before trusting caller-supplied admin identity. */
    const request = context.switchToHttp().getRequest<Request>();
    const sharedTokenHeader = request.headers?.[BOT_BACKEND_TOKEN_HEADER];
    const sharedToken = Array.isArray(sharedTokenHeader) ? sharedTokenHeader[0] : sharedTokenHeader;
    if (!sharedToken) {
      throw new UnauthorizedException("Missing bot backend token");
    }

    const received = Buffer.from(sharedToken, "utf-8");
    const expected = Buffer.from(this.config.botBackendAuthToken, "utf-8");
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      throw new UnauthorizedException("Invalid bot backend token");
    }

    /* Extract and validate admin id only after shared secret succeeds. */
    const adminIdHeader = request.headers?.[ADMIN_ID_HEADER];
    const rawId = Array.isArray(adminIdHeader) ? adminIdHeader[0] : adminIdHeader;

    if (!rawId) {
      throw new UnauthorizedException("Missing admin id");
    }

    const parsed = Number(rawId);
    if (!Number.isFinite(parsed) || !this.config.adminIds.includes(parsed)) {
      throw new UnauthorizedException("Invalid admin id");
    }

    /* Expose admin identity for downstream handlers/services. */
    (request as any).authAdminId = parsed;

    return true;
  }
}
