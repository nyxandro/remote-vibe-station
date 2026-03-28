/**
 * @fileoverview Authenticated Mini App endpoints for runtime service dashboard and restarts.
 *
 * Exports:
 * - RuntimeServicesController - Returns service health snapshot and restarts managed services.
 */

import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Logger, Param, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { EventsService } from "../events/events.service";
import { publishWorkspaceStateChangedEvent } from "../events/workspace-events";
import { createAppErrorBody, normalizeUnknownErrorToAppError } from "../logging/app-error";
import { AppAuthGuard } from "../security/app-auth.guard";
import { RuntimeServicesService } from "./runtime-services.service";

@Controller("api/telegram/system")
export class RuntimeServicesController {
  private readonly logger = new Logger(RuntimeServicesController.name);

  public constructor(
    private readonly runtimeServices: RuntimeServicesService,
    private readonly events: EventsService
  ) {}

  @UseGuards(AppAuthGuard)
  @Get("services")
  public async getServices(@Req() req: Request) {
    /* Service dashboard is admin-only because it exposes runtime topology and restart controls. */
    this.requireAdminIdentity(req);
    return this.runtimeServices.getSnapshot();
  }

  @UseGuards(AppAuthGuard)
  @Post("services/:serviceId/restart")
  @HttpCode(HttpStatus.OK)
  public async restartService(@Param("serviceId") serviceId: string, @Req() req: Request) {
    /* Route-level validation keeps operator actions explicit and prevents accidental wildcard restarts. */
    const adminId = this.requireAdminIdentity(req);
    if (!this.runtimeServices.isManagedServiceId(serviceId)) {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_RUNTIME_SERVICE_ID_INVALID",
          message: "Runtime service id is invalid.",
          hint: "Use one of: miniapp, bot, opencode, cliproxy."
        })
      );
    }

    try {
      const result = await this.runtimeServices.restartService(serviceId);
      try {
        await publishWorkspaceStateChangedEvent({
          events: this.events,
          adminId,
          surfaces: ["settings", "providers"],
          reason: `runtime.service.restart.${serviceId}`
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to publish runtime restart event for ${serviceId}: ${message}`);
      }

      return result;
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_RUNTIME_SERVICE_RESTART_FAILED",
          fallbackMessage: `Failed to restart runtime service '${serviceId}'.`,
          fallbackHint: "Check Docker/runtime health and retry the service restart."
        })
      );
    }
  }

  private requireAdminIdentity(req: Request): number {
    /* Keep admin check explicit for parity with the other Telegram Mini App controllers. */
    const adminId = (req as Request & { authAdminId?: number }).authAdminId;
    if (adminId == null) {
      throw new UnauthorizedException(
        createAppErrorBody({
          code: "APP_RUNTIME_SERVICE_ADMIN_REQUIRED",
          message: "Admin identity is required for runtime service operations.",
          hint: "Reopen the Mini App from Telegram and retry."
        })
      );
    }

    return adminId;
  }
}
