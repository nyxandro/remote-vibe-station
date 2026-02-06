/**
 * @fileoverview Guard that validates admin id header.
 *
 * Exports:
 * - ADMIN_ID_HEADER (L14) - Header carrying admin id.
 * - AdminHeaderGuard (L16) - Ensures x-admin-id belongs to admins.
 */

import { CanActivate, ExecutionContext, Inject, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";

import { AppConfig, ConfigToken } from "../config/config.types";

const ADMIN_ID_HEADER = "x-admin-id";

export class AdminHeaderGuard implements CanActivate {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public canActivate(context: ExecutionContext): boolean {
    /* Extract admin id from headers. */
    const request = context.switchToHttp().getRequest<Request>();
    const rawId = request.headers?.[ADMIN_ID_HEADER] as string | undefined;

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
