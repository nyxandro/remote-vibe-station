/**
 * @fileoverview Authenticated HTTP endpoint for scoped WebSocket token issuance.
 *
 * Exports:
 * - EventsController - Mints short-lived tokens for `/events` subscriptions.
 */

import { BadRequestException, Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { createAppErrorBody } from "../logging/app-error";
import { AppAuthGuard } from "../security/app-auth.guard";
import { EventStreamTopic } from "./event-stream-auth";
import { EventStreamAuthService } from "./event-stream-auth.service";

type EventsTokenBody = {
  topics?: unknown;
  projectSlug?: unknown;
};

@Controller("api/events")
@UseGuards(AppAuthGuard)
export class EventsController {
  public constructor(private readonly auth: EventStreamAuthService) {}

  @Post("token")
  public issueToken(@Body() body: EventsTokenBody, @Req() request: Request) {
    /* HTTP auth stays the source of truth, then the browser upgrades into a scoped WS token. */
    const adminId = (request as Request & { authAdminId?: number }).authAdminId;
    if (typeof adminId !== "number") {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_EVENT_STREAM_ADMIN_REQUIRED",
          message: "Admin identity is required before issuing event token.",
          hint: "Authenticate through Telegram initData or browser token and retry."
        })
      );
    }

    const topics = this.parseTopics(body?.topics);
    const projectSlug = this.parseProjectSlug(body?.projectSlug);

    try {
      return this.auth.issueToken({ adminId, topics, projectSlug });
    } catch (error) {
      throw new BadRequestException(this.toIssueTokenErrorBody(error));
    }
  }

  private parseTopics(raw: unknown): EventStreamTopic[] {
    /* Keep body parsing explicit so malformed clients get a stable 400 instead of silent coercion. */
    if (!Array.isArray(raw)) {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_EVENT_STREAM_TOPICS_REQUIRED",
          message: "Event-stream topics must be a non-empty array.",
          hint: "Send one or more supported topics such as 'kanban', 'terminal' or 'workspace'."
        })
      );
    }

    const topics = raw
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value): value is EventStreamTopic => value === "kanban" || value === "terminal" || value === "workspace");
    if (topics.length === 0) {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_EVENT_STREAM_TOPICS_UNSUPPORTED",
          message: "Event-stream topics must include at least one supported topic.",
          hint: "Use 'kanban', 'terminal' and/or 'workspace' when requesting an event token."
        })
      );
    }
    return topics;
  }

  private parseProjectSlug(raw: unknown): string | null {
    /* Project scope stays optional for kanban but required for terminal, enforced by token service. */
    if (typeof raw !== "string") {
      return null;
    }

    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toIssueTokenErrorBody(error: unknown) {
    /* Event-token failures map backend validation messages into stable API error metadata. */
    const message = error instanceof Error ? error.message : "Invalid event-stream subscription request";
    if (message === "projectSlug is required for terminal topic") {
      return createAppErrorBody({
        code: "APP_EVENT_STREAM_PROJECT_SCOPE_REQUIRED",
        message: "Terminal subscriptions require project scope.",
        hint: "Select a project slug before opening the terminal event stream."
      });
    }

    if (message === "At least one event-stream topic is required") {
      return createAppErrorBody({
        code: "APP_EVENT_STREAM_TOPICS_REQUIRED",
        message: "Event-stream topics must be a non-empty array.",
        hint: "Send one or more supported topics such as 'kanban', 'terminal' or 'workspace'."
      });
    }

    return createAppErrorBody({
      code: "APP_EVENT_STREAM_TOKEN_REQUEST_INVALID",
      message,
      hint: "Review requested topics/project scope and retry token issuance."
    });
  }
}
