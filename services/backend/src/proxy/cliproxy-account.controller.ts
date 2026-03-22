/**
 * @fileoverview Authenticated Mini App API for CLIProxy account onboarding.
 *
 * Exports:
 * - CliproxyAccountController - Lists account statuses and handles OAuth start/callback.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { Request } from "express";

import { AppAuthGuard } from "../security/app-auth.guard";
import { CliproxyAccountService } from "./cliproxy-account.service";
import { CliproxyProviderId } from "./cliproxy-management.client";
import {
  cliproxyAccountIdInvalidError,
  cliproxyAccountIdRequiredError,
  cliproxyCompletionInputRequiredError,
  cliproxyProviderUnsupportedError,
  requireProxyAdminId
} from "./proxy-controller-errors";

@Controller("api/telegram/cliproxy")
export class CliproxyAccountController {
  public constructor(private readonly accounts: CliproxyAccountService) {}

  @UseGuards(AppAuthGuard)
  @Get("state")
  public async getState(@Req() req: Request) {
    /* Endpoint is admin-only to avoid exposing account metadata publicly. */
    requireProxyAdminId(req);
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
    requireProxyAdminId(req);
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
    requireProxyAdminId(req);
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

  @UseGuards(AppAuthGuard)
  @Post("accounts/:accountId/test")
  @HttpCode(HttpStatus.OK)
  public async testAccount(@Param("accountId") accountId: string, @Req() req: Request) {
    /* Manual test triggers a lightweight live request so stale limit/error statuses refresh immediately. */
    requireProxyAdminId(req);
    await this.accounts.testAccount({ accountId: this.assertAccountId(accountId) });
    return { ok: true };
  }

  @UseGuards(AppAuthGuard)
  @Post("accounts/:accountId/activate")
  @HttpCode(HttpStatus.OK)
  public async activateAccount(@Param("accountId") accountId: string, @Req() req: Request) {
    /* Manual switch pins one auth file so operators can steer traffic to a specific account. */
    requireProxyAdminId(req);
    await this.accounts.activateAccount({ accountId: this.assertAccountId(accountId) });
    return { ok: true };
  }

  @UseGuards(AppAuthGuard)
  @Delete("accounts/:accountId")
  @HttpCode(HttpStatus.OK)
  public async deleteAccount(@Param("accountId") accountId: string, @Req() req: Request) {
    /* Deletion removes the stored auth file from CLIProxy management pool. */
    requireProxyAdminId(req);
    await this.accounts.deleteAccount({ accountId: this.assertAccountId(accountId) });
    return { ok: true };
  }

  private assertProvider(provider?: string): CliproxyProviderId {
    /* Controller-level provider validation blocks undefined/unknown values early. */
    const normalized = typeof provider === "string" ? provider.trim() : "";
    const supported: CliproxyProviderId[] = ["codex", "anthropic", "antigravity", "kimi", "qwen", "iflow"];
    if (!supported.includes(normalized as CliproxyProviderId)) {
      throw cliproxyProviderUnsupportedError();
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
      throw cliproxyCompletionInputRequiredError();
    }
  }

  private assertAccountId(accountId?: string): string {
    /* Account mutations require a concrete auth file identifier from management state payload. */
    const normalized = typeof accountId === "string" ? accountId.trim() : "";
    if (!normalized) {
      throw cliproxyAccountIdRequiredError();
    }
    if (normalized.includes("..") || /[\/\\\0]/.test(normalized)) {
      throw cliproxyAccountIdInvalidError();
    }
    return normalized;
  }
}
