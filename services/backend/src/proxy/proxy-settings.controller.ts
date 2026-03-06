/**
 * @fileoverview Authenticated Mini App API for CLI/Proxy settings management.
 *
 * Exports:
 * - ProxySettingsController - Reads and updates persisted proxy profile.
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
import { ProxySettingsService } from "./proxy-settings.service";
import { ProxySettingsInput } from "./proxy-settings.types";

@Controller("api/telegram/proxy")
export class ProxySettingsController {
  public constructor(private readonly proxySettings: ProxySettingsService) {}

  @UseGuards(AppAuthGuard)
  @Get("settings")
  public async getSettings(@Req() req: Request) {
    /* Keep auth identity check explicit for parity with existing Telegram controllers. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }

    return this.proxySettings.getSettings();
  }

  @UseGuards(AppAuthGuard)
  @Post("settings")
  @HttpCode(HttpStatus.OK)
  public async saveSettings(@Body() body: Partial<ProxySettingsInput>, @Req() req: Request) {
    /* Validate payload shape before delegating to service-level invariants. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }

    if (body.mode !== "direct" && body.mode !== "vless") {
      throw new BadRequestException("mode must be either 'direct' or 'vless'");
    }

    if (typeof body.noProxy !== "string") {
      throw new BadRequestException("noProxy is required");
    }

    /* Keep vless input strict at boundary layer before service normalization/validation. */
    if (
      body.mode === "vless" &&
      (typeof body.vlessProxyUrl !== "string" || body.vlessProxyUrl.trim().length === 0)
    ) {
      throw new BadRequestException("vlessProxyUrl is required for vless mode");
    }

    const payload: ProxySettingsInput = {
      mode: body.mode,
      vlessProxyUrl: typeof body.vlessProxyUrl === "string" ? body.vlessProxyUrl.trim() : null,
      noProxy: body.noProxy.trim()
    };

    return this.proxySettings.updateSettings(payload);
  }

  @UseGuards(AppAuthGuard)
  @Post("settings/apply")
  @HttpCode(HttpStatus.OK)
  public async applySettings(@Req() req: Request) {
    /* Apply action is admin-only because it mutates running docker services. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }

    return this.proxySettings.applyRuntimeStack();
  }
}
