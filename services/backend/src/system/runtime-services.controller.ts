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
import { RuntimeUpdateService } from "./runtime-update.service";

@Controller("api/telegram/system")
export class RuntimeServicesController {
  private readonly logger = new Logger(RuntimeServicesController.name);

  public constructor(
    private readonly runtimeServices: RuntimeServicesService,
    private readonly runtimeUpdate: RuntimeUpdateService,
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
  @Get("runtime/version")
  public async getRuntimeVersion(@Req() req: Request) {
    /* Runtime version is admin-only because it exposes image refs and rollback availability. */
    this.requireAdminIdentity(req);
    try {
      return await this.runtimeUpdate.getVersionSnapshot();
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_RUNTIME_VERSION_READ_FAILED",
          fallbackMessage: "Failed to read runtime version.",
          fallbackHint: "Check runtime .env mount and retry opening settings."
        })
      );
    }
  }

  @UseGuards(AppAuthGuard)
  @Get("runtime/update/state")
  public async getRuntimeUpdateState(@Req() req: Request) {
    /* Persisted update state lets Mini App reconnect after backend restarts during self-update. */
    this.requireAdminIdentity(req);
    try {
      return await this.runtimeUpdate.getUpdateState();
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_RUNTIME_UPDATE_STATE_FAILED",
          fallbackMessage: "Failed to read runtime update status.",
          fallbackHint: "Check runtime config mount and retry opening settings."
        })
      );
    }
  }

  @UseGuards(AppAuthGuard)
  @Post("runtime/version/check")
  @HttpCode(HttpStatus.OK)
  public async checkRuntimeVersion(@Req() req: Request) {
    /* Manual check keeps outbound GitHub calls controlled by an explicit operator action. */
    this.requireAdminIdentity(req);
    try {
      return await this.runtimeUpdate.checkLatestVersion();
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_RUNTIME_VERSION_CHECK_FAILED",
          fallbackMessage: "Failed to check runtime updates.",
          fallbackHint: "Check GitHub access from the server and retry update check."
        })
      );
    }
  }

  @UseGuards(AppAuthGuard)
  @Post("runtime/update")
  @HttpCode(HttpStatus.OK)
  public async updateRuntime(@Req() req: Request) {
    /* Runtime update rewrites image refs and applies Docker Compose on the host-mounted runtime directory. */
    const adminId = this.requireAdminIdentity(req);
    try {
      const result = await this.runtimeUpdate.updateToLatest();
      await this.publishRuntimeChanged(adminId, "runtime.update");
      return result;
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_RUNTIME_UPDATE_FAILED",
          fallbackMessage: "Failed to update runtime.",
          fallbackHint: "Check Docker/GHCR access and retry runtime update."
        })
      );
    }
  }

  @UseGuards(AppAuthGuard)
  @Post("runtime/rollback")
  @HttpCode(HttpStatus.OK)
  public async rollbackRuntime(@Req() req: Request) {
    /* Rollback restores .env.previous and re-applies Compose with the previous image refs. */
    const adminId = this.requireAdminIdentity(req);
    try {
      const result = await this.runtimeUpdate.rollback();
      await this.publishRuntimeChanged(adminId, "runtime.rollback");
      return result;
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_RUNTIME_ROLLBACK_FAILED",
          fallbackMessage: "Failed to rollback runtime.",
          fallbackHint: "Check .env.previous and Docker runtime state, then retry rollback."
        })
      );
    }
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

  private async publishRuntimeChanged(adminId: number, reason: string): Promise<void> {
    /* Best-effort workspace refresh notifies open Mini App sessions after runtime mutations. */
    try {
      await publishWorkspaceStateChangedEvent({
        events: this.events,
        adminId,
        surfaces: ["settings", "providers"],
        reason
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to publish runtime update event: ${message}`);
    }
  }
}
