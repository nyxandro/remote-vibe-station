/**
 * @fileoverview Authenticated Mini App API for CLIProxy account onboarding.
 *
 * Exports:
 * - CliproxyAccountController - Lists account statuses and handles OAuth start/callback.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import { Request } from "express";

import { AppAuthGuard } from "../security/app-auth.guard";
import { CliproxyAccountService } from "./cliproxy-account.service";
import { CliproxyProviderId } from "./cliproxy-management.client";

@Controller("api/telegram/cliproxy")
export class CliproxyAccountController {
  public constructor(private readonly accounts: CliproxyAccountService) {}

  @UseGuards(AppAuthGuard)
  @Get("state")
  public async getState(@Req() req: Request) {
    /* Endpoint is admin-only to avoid exposing account metadata publicly. */
    this.assertAdmin(req);
    return this.accounts.getState();
  }

  @UseGuards(AppAuthGuard)
  @Post("oauth/start")
  @HttpCode(HttpStatus.OK)
  public async startOAuth(
    @Body() body: { provider?: CliproxyProviderId },
    @Req() req: Request
  ) {
    /* Starts provider-specific OAuth/device flow and returns browser URL payload. */
    this.assertAdmin(req);
    return this.accounts.startOAuth({ provider: this.assertProvider(body.provider) });
  }

  @UseGuards(AppAuthGuard)
  @Post("oauth/complete")
  @HttpCode(HttpStatus.OK)
  public async completeOAuth(
    @Body()
    body: {
      provider?: CliproxyProviderId;
      callbackUrl?: string;
      code?: string;
      state?: string;
      error?: string;
    },
    @Req() req: Request
  ) {
    /* Completes OAuth exchange using pasted callback URL or direct code/state fields. */
    this.assertAdmin(req);
    const provider = this.assertProvider(body.provider);
    this.assertCompletionInput(body);

    await this.accounts.completeOAuth({
      provider,
      callbackUrl: body.callbackUrl,
      code: body.code,
      state: body.state,
      error: body.error
    });
    return { ok: true };
  }

  private assertAdmin(req: Request): void {
    /* Keep auth identity check explicit for parity with Telegram endpoints. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }
  }

  private assertProvider(provider?: string): CliproxyProviderId {
    /* Controller-level provider validation blocks undefined/unknown values early. */
    const normalized = typeof provider === "string" ? provider.trim() : "";
    const supported: CliproxyProviderId[] = ["codex", "anthropic", "antigravity", "kimi", "qwen", "iflow"];
    if (!supported.includes(normalized as CliproxyProviderId)) {
      throw new BadRequestException(`Unsupported provider: ${provider ?? "<empty>"}`);
    }
    return normalized as CliproxyProviderId;
  }

  private assertCompletionInput(body: {
    callbackUrl?: string;
    code?: string;
    state?: string;
    error?: string;
  }): void {
    /* Require either full callback URL or explicit state + code/error pair. */
    const callbackUrl = typeof body.callbackUrl === "string" ? body.callbackUrl.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const state = typeof body.state === "string" ? body.state.trim() : "";
    const error = typeof body.error === "string" ? body.error.trim() : "";

    if (callbackUrl) {
      return;
    }

    if (!state || (!code && !error)) {
      throw new BadRequestException("Provide callbackUrl or state with code/error");
    }
  }
}
