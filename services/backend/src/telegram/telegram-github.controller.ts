/**
 * @fileoverview Telegram Mini App endpoints for global GitHub PAT management.
 *
 * Exports:
 * - TelegramGithubController (class) - Returns status, saves PAT, and clears PAT.
 */

import { BadRequestException, Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { GithubAppService } from "../github/github-app.service";
import { AppAuthGuard } from "../security/app-auth.guard";

@Controller("api/telegram/github")
export class TelegramGithubController {
  public constructor(private readonly github: GithubAppService) {}

  @UseGuards(AppAuthGuard)
  @Get("status")
  public getStatus(@Req() req: Request) {
    /* PAT is managed from Settings but still requires authenticated admin context. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }
    return this.github.getStatus(adminId);
  }

  @UseGuards(AppAuthGuard)
  @Post("token")
  public saveToken(@Req() req: Request, @Body() body: { token?: string }) {
    /* Save the pasted GitHub PAT as the global credential source for backend and OpenCode git operations. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }

    try {
      return this.github.saveToken({ adminId, token: String(body?.token ?? "") });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @UseGuards(AppAuthGuard)
  @Post("disconnect")
  public disconnect(@Req() req: Request, @Body() _body: Record<string, never>) {
    /* Clearing the PAT immediately disables future GitHub HTTPS auth for all runtime git commands. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }
    return this.github.disconnect(adminId);
  }
}
