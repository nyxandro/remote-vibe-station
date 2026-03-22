/**
 * @fileoverview Injectable wrapper around signed event-stream token helpers.
 *
 * Exports:
 * - EventStreamAuthService - Issues and verifies scoped WebSocket tokens.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import {
  createEventStreamToken,
  EventStreamTopic,
  getEventStreamTokenTtlMs,
  verifyEventStreamToken
} from "./event-stream-auth";

@Injectable()
export class EventStreamAuthService {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public issueToken(input: { adminId: number; topics: EventStreamTopic[]; projectSlug?: string | null }) {
    /* Keep HTTP-issued subscription scope aligned with the same bot-token-based signing secret. */
    const nowMs = Date.now();
    return {
      token: createEventStreamToken({
        adminId: input.adminId,
        botToken: this.config.telegramBotToken,
        topics: input.topics,
        projectSlug: input.projectSlug,
        nowMs
      }),
      expiresAt: new Date(nowMs + getEventStreamTokenTtlMs()).toISOString()
    };
  }

  public verifyToken(input: { token: string }) {
    /* Gateway verification stays centralized so future token format changes touch one service only. */
    return verifyEventStreamToken({
      token: input.token,
      botToken: this.config.telegramBotToken
    });
  }
}
