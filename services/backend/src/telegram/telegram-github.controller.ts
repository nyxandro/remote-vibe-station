/**
 * @fileoverview Telegram Mini App endpoints for GitHub App connect/disconnect flow.
 *
 * Exports:
 * - TelegramGithubController (class) - Starts install, handles callback, returns status.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import { Request, Response } from "express";

import { GithubAppService } from "../github/github-app.service";
import { AppAuthGuard } from "../security/app-auth.guard";

@Controller("api/telegram/github")
export class TelegramGithubController {
  public constructor(private readonly github: GithubAppService) {}

  @UseGuards(AppAuthGuard)
  @Get("status")
  public getStatus(@Req() req: Request) {
    /* Return current GitHub app connectivity state for authenticated admin. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }
    return this.github.getStatus(adminId);
  }

  @UseGuards(AppAuthGuard)
  @Post("connect/start")
  public startInstall(@Req() req: Request) {
    /* Create one-time install URL and return it for browser redirect. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }

    try {
      return this.github.startInstall(adminId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @Get("connect/callback")
  public callback(
    @Query()
    query: {
      state?: string;
      installation_id?: string;
      setup_action?: string;
      account?: { login?: string; type?: string };
    },
    @Res({ passthrough: false }) response: Response
  ): string {
    /* Complete install binding and render deterministic callback HTML page. */
    try {
      const result = this.github.completeInstall(query);
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return this.renderHtml({
        title: "GitHub подключен",
        body: `Установка сохранена для admin ${result.adminId}. Можно закрыть окно и вернуться в Mini App.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      response.status(400);
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return this.renderHtml({
        title: "Ошибка подключения GitHub",
        body: `Не удалось завершить подключение: ${message}`
      });
    }
  }

  @UseGuards(AppAuthGuard)
  @Post("disconnect")
  public disconnect(@Req() req: Request, @Body() _body: Record<string, never>) {
    /* Remove persisted GitHub installation binding for this admin. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }
    return this.github.disconnect(adminId);
  }

  private renderHtml(input: { title: string; body: string }): string {
    /* Keep callback UX minimal and deterministic across mobile browsers. */
    const safeTitle = this.escapeHtml(input.title);
    const safeBody = this.escapeHtml(input.body);
    return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; }
      .card { max-width: 560px; padding: 16px 20px; border: 1px solid #d9d9d9; border-radius: 10px; }
      h1 { margin: 0 0 12px; font-size: 20px; }
      p { margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${safeTitle}</h1>
      <p>${safeBody}</p>
    </div>
  </body>
</html>`;
  }

  private escapeHtml(value: string): string {
    /* Escape dynamic text before embedding into callback HTML response. */
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
