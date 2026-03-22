/**
 * @fileoverview Authenticated Mini App API for CLI/Proxy settings management.
 *
 * Exports:
 * - ProxySettingsController - Reads and updates persisted proxy profile.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { AppAuthGuard } from "../security/app-auth.guard";
import { ProxySettingsService } from "./proxy-settings.service";
import { ProxySettingsInput } from "./proxy-settings.types";
import {
  proxyModeInvalidError,
  proxyNoProxyRequiredError,
  proxyVlessUrlRequiredError,
  requireProxyAdminId
} from "./proxy-controller-errors";

@Controller("api/telegram/proxy")
export class ProxySettingsController {
  public constructor(private readonly proxySettings: ProxySettingsService) {}

  @UseGuards(AppAuthGuard)
  @Get("settings")
  public async getSettings(@Req() req: Request) {
    /* Keep auth identity check explicit for parity with existing Telegram controllers. */
    requireProxyAdminId(req);

    return this.proxySettings.getSettings();
  }

  @UseGuards(AppAuthGuard)
  @Post("settings")
  @HttpCode(HttpStatus.OK)
  public async saveSettings(@Body() body: Partial<ProxySettingsInput>, @Req() req: Request) {
    /* Validate payload shape before delegating to service-level invariants. */
    requireProxyAdminId(req);

    if (body.mode !== "direct" && body.mode !== "vless") {
      throw proxyModeInvalidError();
    }

    if (typeof body.noProxy !== "string") {
      throw proxyNoProxyRequiredError();
    }

    /* Keep vless input strict at boundary layer before service normalization/validation. */
    if (
      body.mode === "vless" &&
      (typeof body.vlessProxyUrl !== "string" || body.vlessProxyUrl.trim().length === 0)
    ) {
      throw proxyVlessUrlRequiredError();
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
    requireProxyAdminId(req);

    return this.proxySettings.applyRuntimeStack();
  }
}
