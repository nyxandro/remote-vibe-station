/**
 * @fileoverview Telegram Mini App endpoints for OpenCode provider onboarding.
 *
 * Exports:
 * - TelegramProviderController (L20) - Lists providers and handles connect/disconnect flows.
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

import { OpenCodeProviderAuthClient } from "../open-code/opencode-provider-auth.client";
import { AppAuthGuard } from "../security/app-auth.guard";
import { TelegramPreferencesService } from "./preferences/telegram-preferences.service";

@Controller("api/telegram/providers")
export class TelegramProviderController {
  public constructor(
    private readonly providerAuth: OpenCodeProviderAuthClient,
    private readonly preferences: TelegramPreferencesService
  ) {}

  @UseGuards(AppAuthGuard)
  @Get()
  public async getProviderOverview(@Req() req: Request) {
    /* Build Mini App provider snapshot with selected mode and available auth methods. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }

    const [settings, authMethods] = await Promise.all([
      this.preferences.getSettings(adminId),
      this.providerAuth.listProviderAuthMethods()
    ]);

    return {
      selected: settings.selected,
      providers: settings.providers,
      authMethods
    };
  }

  @UseGuards(AppAuthGuard)
  @Post("oauth/authorize")
  @HttpCode(HttpStatus.OK)
  public async authorizeOAuth(
    @Body() body: { providerID?: string; method?: number },
    @Req() req: Request
  ) {
    /* Start provider OAuth flow and return redirect payload for Mini App modal. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }

    const providerID = String(body?.providerID ?? "").trim();
    if (!providerID) {
      throw new BadRequestException("providerID is required");
    }

    if (
      typeof body?.method !== "number" ||
      !Number.isFinite(body.method) ||
      !Number.isInteger(body.method) ||
      body.method < 0
    ) {
      throw new BadRequestException("method index is required");
    }

    try {
      const auth = await this.providerAuth.authorizeOAuth({ providerID, method: body.method });
      return { ok: true, url: auth.url, method: auth.method, instructions: auth.instructions };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @UseGuards(AppAuthGuard)
  @Post("oauth/callback")
  @HttpCode(HttpStatus.OK)
  public async completeOAuth(
    @Body() body: { providerID?: string; method?: number; code?: string },
    @Req() req: Request
  ) {
    /* Complete OAuth flow for auto/code methods and persist provider tokens. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }

    const providerID = String(body?.providerID ?? "").trim();
    if (!providerID) {
      throw new BadRequestException("providerID is required");
    }

    if (
      typeof body?.method !== "number" ||
      !Number.isFinite(body.method) ||
      !Number.isInteger(body.method) ||
      body.method < 0
    ) {
      throw new BadRequestException("method index is required");
    }

    try {
      await this.providerAuth.completeOAuth({
        providerID,
        method: body.method,
        code: typeof body.code === "string" ? body.code.trim() : undefined
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @UseGuards(AppAuthGuard)
  @Post("api-key")
  @HttpCode(HttpStatus.OK)
  public async setApiKey(
    @Body() body: { providerID?: string; key?: string },
    @Req() req: Request
  ) {
    /* Save provider API key via backend to keep OpenCode credential store in sync. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }

    const providerID = String(body?.providerID ?? "").trim();
    const key = String(body?.key ?? "").trim();
    if (!providerID) {
      throw new BadRequestException("providerID is required");
    }
    if (!key) {
      throw new BadRequestException("key is required");
    }

    try {
      await this.providerAuth.setApiKey({ providerID, key });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @UseGuards(AppAuthGuard)
  @Post("disconnect")
  @HttpCode(HttpStatus.OK)
  public async disconnect(
    @Body() body: { providerID?: string },
    @Req() req: Request
  ) {
    /* Remove provider credentials to explicitly disconnect account from OpenCode. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }

    const providerID = String(body?.providerID ?? "").trim();
    if (!providerID) {
      throw new BadRequestException("providerID is required");
    }

    try {
      await this.providerAuth.disconnectProvider({ providerID });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }
}
