/**
 * @fileoverview Authenticated Mini App API for CLI/Proxy settings management.
 *
 * Exports:
 * - ProxySettingsController - Reads and updates persisted proxy profile.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { EventsService } from "../events/events.service";
import { publishWorkspaceStateChangedEvent } from "../events/workspace-events";
import { AppAuthGuard } from "../security/app-auth.guard";
import { ProxySettingsService } from "./proxy-settings.service";
import { ProxyEnabledService, ProxySettingsInput, ProxySettingsTestInput } from "./proxy-settings.types";
import {
  proxyModeInvalidError,
  proxyNoProxyRequiredError,
  proxyTestUrlRequiredError,
  proxyEnabledServicesRequiredError,
  proxyVlessUrlRequiredError,
  requireProxyAdminId
} from "./proxy-controller-errors";

const PROXY_SERVICE_IDS: ProxyEnabledService[] = ["backend", "bot", "miniapp", "opencode", "cliproxy"];

@Controller("api/telegram/proxy")
export class ProxySettingsController {
  public constructor(
    private readonly proxySettings: ProxySettingsService,
    private readonly events: EventsService
  ) {}

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

    if (!Array.isArray(body.enabledServices) || body.enabledServices.length === 0) {
      throw proxyEnabledServicesRequiredError();
    }

    /* Keep vless input strict at boundary layer before service normalization/validation. */
    if (
      body.mode === "vless" &&
      (typeof body.vlessProxyUrl !== "string" || body.vlessProxyUrl.trim().length === 0)
    ) {
      throw proxyVlessUrlRequiredError();
    }

    if (
      body.mode === "vless" &&
      (typeof body.vlessConfigUrl !== "string" || body.vlessConfigUrl.trim().length === 0)
    ) {
      throw proxyTestUrlRequiredError();
    }

    const payload: ProxySettingsInput = {
      mode: body.mode,
      vlessProxyUrl: typeof body.vlessProxyUrl === "string" ? body.vlessProxyUrl.trim() : null,
      vlessConfigUrl: typeof body.vlessConfigUrl === "string" ? body.vlessConfigUrl.trim() : null,
      enabledServices: body.enabledServices.filter((serviceId): serviceId is ProxyEnabledService => {
        return PROXY_SERVICE_IDS.includes(serviceId as ProxyEnabledService);
      }),
      noProxy: body.noProxy.trim()
    };

    const result = await this.proxySettings.updateSettings(payload);
    publishWorkspaceStateChangedEvent({
      events: this.events,
      adminId: (req as Request & { authAdminId?: number }).authAdminId,
      surfaces: ["providers"],
      reason: "proxy.settings.save"
    });
    return result;
  }

  @UseGuards(AppAuthGuard)
  @Post("settings/test")
  @HttpCode(HttpStatus.OK)
  public async testSettings(@Body() body: Partial<ProxySettingsTestInput>, @Req() req: Request) {
    /* Separate test endpoint lets UI validate pasted config before enabling save. */
    requireProxyAdminId(req);

    if (typeof body.vlessConfigUrl !== "string" || body.vlessConfigUrl.trim().length === 0) {
      throw proxyTestUrlRequiredError();
    }

    return this.proxySettings.testVlessConfigUrl({ vlessConfigUrl: body.vlessConfigUrl.trim() });
  }

  @UseGuards(AppAuthGuard)
  @Post("settings/apply")
  @HttpCode(HttpStatus.OK)
  public async applySettings(@Req() req: Request) {
    /* Apply action is admin-only because it mutates running docker services. */
    requireProxyAdminId(req);

    const result = await this.proxySettings.applyRuntimeStack();
    publishWorkspaceStateChangedEvent({
      events: this.events,
      adminId: (req as Request & { authAdminId?: number }).authAdminId,
      surfaces: ["providers"],
      reason: "proxy.settings.apply"
    });
    return result;
  }
}
