/**
 * @fileoverview Guard for trusted OpenCode plugin -> backend kanban calls.
 *
 * Exports:
 * - KanbanAgentGuard - Requires only the shared backend token for internal agent tool requests.
 */

import * as crypto from "node:crypto";

import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";

import { AppConfig, ConfigToken } from "../config/config.types";
import { BOT_BACKEND_TOKEN_HEADER } from "./admin-header.guard";

@Injectable()
export class KanbanAgentGuard implements CanActivate {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public canActivate(context: ExecutionContext): boolean {
    /* OpenCode plugin runs in a trusted container, so the shared backend token is sufficient here. */
    const request = context.switchToHttp().getRequest<Request>();
    const tokenHeader = request.headers?.[BOT_BACKEND_TOKEN_HEADER];
    const sharedToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    if (!sharedToken) {
      throw new UnauthorizedException("Missing bot backend token");
    }

    const received = Buffer.from(sharedToken, "utf-8");
    const expected = Buffer.from(this.config.botBackendAuthToken, "utf-8");
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      throw new UnauthorizedException("Invalid bot backend token");
    }

    return true;
  }
}
