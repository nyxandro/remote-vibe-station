/**
 * @fileoverview Telegram endpoints for OpenCode session lifecycle actions.
 *
 * Exports:
 * - TelegramSessionController (L16) - Handles /new, /sessions and session selection callbacks.
 */

import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { OpenCodeSessionRoutingStore } from "../open-code/opencode-session-routing.store";
import { PromptService } from "../prompt/prompt.service";
import { AdminHeaderGuard } from "../security/admin-header.guard";

@Controller("api/telegram")
export class TelegramSessionController {
  public constructor(
    private readonly prompts: PromptService,
    private readonly sessionRouting: OpenCodeSessionRoutingStore
  ) {}

  @UseGuards(AdminHeaderGuard)
  @Post("session/new")
  public async startNewSession(@Req() req: Request) {
    /* Start explicit new OpenCode session for active project and current Telegram admin. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    try {
      const result = await this.prompts.startNewSession(adminId);
      return { ...result, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @UseGuards(AdminHeaderGuard)
  @Get("sessions")
  public async listSessions(@Req() req: Request) {
    /* Return project-scoped session list with callback tokens for Telegram inline picker. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    try {
      const result = await this.prompts.listSessions(adminId);
      const sessions = (Array.isArray(result.sessions) ? result.sessions : []).map((session) => ({
        sessionToken: this.sessionRouting.bindSession({
          sessionID: session.id,
          adminId,
          directory: result.directory
        }),
        title: session.title,
        status: session.status,
        updatedAt: session.updatedAt,
        active: session.active
      }));

      return { ok: true, projectSlug: result.projectSlug, sessions };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @UseGuards(AdminHeaderGuard)
  @Post("session/select")
  public async selectSession(@Body() body: { sessionToken?: string }, @Req() req: Request) {
    /* Apply selected session token from inline callback and consume token after success. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    const sessionToken = String(body?.sessionToken ?? "").trim();
    if (!sessionToken) {
      throw new BadRequestException("sessionToken is required");
    }

    const route = this.sessionRouting.resolveSessionToken(sessionToken);
    if (!route || route.adminId !== adminId) {
      throw new BadRequestException("Session token not found");
    }

    try {
      const result = await this.prompts.selectSession({ adminId, sessionID: route.sessionID });
      this.sessionRouting.consumeSessionToken(sessionToken);
      return { ...result, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }
}
