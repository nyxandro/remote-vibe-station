/**
 * @fileoverview OpenCode integration endpoints.
 *
 * Exports:
 * - OpenCodeController - Routes for OpenCode-related actions.
 */

import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { EventsService } from "../events/events.service";
import { publishWorkspaceStateChangedEvent } from "../events/workspace-events";
import { createAppErrorBody, normalizeUnknownErrorToAppError } from "../logging/app-error";
import { AppAuthGuard } from "../security/app-auth.guard";
import { OpenCodeProjectSyncService } from "./opencode-project-sync.service";
import { OpenCodeRuntimeService } from "./opencode-runtime.service";
import { OpenCodeSettingsKind, OpenCodeSettingsService } from "./opencode-settings.service";

@Controller("api/opencode")
@UseGuards(AppAuthGuard)
export class OpenCodeController {
  public constructor(
    private readonly sync: OpenCodeProjectSyncService,
    private readonly settings: OpenCodeSettingsService,
    private readonly runtime: OpenCodeRuntimeService,
    private readonly events: EventsService
  ) {}

  @Post("sync-projects")
  public async syncProjects(@Req() req: Request) {
    /* Sync PROJECTS_ROOT folders into OpenCode storage (best-effort hack). */
    try {
      const result = await this.sync.sync();
      publishWorkspaceStateChangedEvent({
        events: this.events,
        adminId: (req as Request & { authAdminId?: number }).authAdminId,
        surfaces: ["projects"],
        reason: "opencode.sync-projects"
      });
      return result;
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_SYNC_FAILED",
          fallbackMessage: "Failed to sync OpenCode project list.",
          fallbackHint: "Check OpenCode/backend connectivity and retry the sync."
        })
      );
    }
  }

  @Post("warm-recents")
  public async warmRecents() {
    /* Populate OpenCode "recent projects" by opening directories once. */
    try {
      return await this.sync.warmRecents();
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_WARM_RECENTS_FAILED",
          fallbackMessage: "Failed to warm recent OpenCode projects.",
          fallbackHint: "Check OpenCode runtime health and retry the warm-recents action."
        })
      );
    }
  }

  @Post("restart")
  public async restartOpenCode(@Req() req: Request) {
    /* Restart OpenCode containers so config/rules changes are reloaded. */
    try {
      const result = await this.runtime.restartServiceContainers();
      publishWorkspaceStateChangedEvent({
        events: this.events,
        adminId: (req as Request & { authAdminId?: number }).authAdminId,
        surfaces: ["settings"],
        reason: "opencode.restart"
      });
      return result;
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_RESTART_FAILED",
          fallbackMessage: "Failed to restart OpenCode runtime.",
          fallbackHint: "Check Docker/OpenCode runtime status and retry the restart."
        })
      );
    }
  }

  @Get("version/status")
  public async getVersionStatus() {
    /* Return current and last-checked latest OpenCode versions for Settings UI. */
    try {
      return await this.runtime.getVersionStatus();
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_VERSION_STATUS_FAILED",
          fallbackMessage: "Failed to read OpenCode version status.",
          fallbackHint: "Check OpenCode runtime availability and retry version status loading."
        })
      );
    }
  }

  @Post("version/check")
  public async checkVersionStatus(@Req() req: Request) {
    /* Force latest-version lookup from npm and update backend cache. */
    try {
      const result = await this.runtime.checkVersionStatus();
      publishWorkspaceStateChangedEvent({
        events: this.events,
        adminId: (req as Request & { authAdminId?: number }).authAdminId,
        surfaces: ["settings"],
        reason: "opencode.version.check"
      });
      return result;
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_VERSION_CHECK_FAILED",
          fallbackMessage: "Failed to check latest OpenCode version.",
          fallbackHint: "Check outbound npm access and retry the version check."
        })
      );
    }
  }

  @Post("version/update")
  public async updateVersion(@Req() req: Request) {
    /* Install latest OpenCode version into running container and restart runtime. */
    try {
      const result = await this.runtime.updateToLatestVersion();
      publishWorkspaceStateChangedEvent({
        events: this.events,
        adminId: (req as Request & { authAdminId?: number }).authAdminId,
        surfaces: ["settings"],
        reason: "opencode.version.update"
      });
      return result;
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_VERSION_UPDATE_FAILED",
          fallbackMessage: "Failed to update OpenCode version.",
          fallbackHint: "Use immutable image redeploy flow or inspect runtime logs, then retry."
        })
      );
    }
  }

  @Get("settings/overview")
  public getSettingsOverview(@Query("projectId") projectId?: string) {
    /* Read all OpenCode settings sections for accordion rendering. */
    try {
      return this.settings.getOverview(projectId ?? null);
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_SETTINGS_OVERVIEW_FAILED",
          fallbackMessage: "Failed to read OpenCode settings overview.",
          fallbackHint: "Check OpenCode settings storage and retry the overview request."
        })
      );
    }
  }

  @Post("settings/read")
  public readSettingsFile(
    @Body() body: { kind?: OpenCodeSettingsKind; projectId?: string; relativePath?: string }
  ) {
    /* Read one settings file by section kind. */
    if (!body?.kind) {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_OPENCODE_SETTINGS_KIND_REQUIRED",
          message: "Settings file kind is required.",
          hint: "Send a valid settings kind such as config, globalRule or projectEnvFile."
        })
      );
    }
    try {
      return this.settings.readFile(body.kind, body.projectId ?? null, body.relativePath);
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_SETTINGS_READ_FAILED",
          fallbackMessage: "Failed to read OpenCode settings file.",
          fallbackHint: "Check selected file path and retry the read request."
        })
      );
    }
  }

  @Post("settings/save")
  public saveSettingsFile(
    @Body()
    body: { kind?: OpenCodeSettingsKind; projectId?: string; relativePath?: string; content?: string },
    @Req() req: Request
  ) {
    /* Save one settings file by section kind. */
    if (!body?.kind) {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_OPENCODE_SETTINGS_KIND_REQUIRED",
          message: "Settings file kind is required.",
          hint: "Send a valid settings kind such as config, globalRule or projectEnvFile."
        })
      );
    }
    if (typeof body.content !== "string") {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_OPENCODE_SETTINGS_CONTENT_REQUIRED",
          message: "Settings file content is required.",
          hint: "Provide text content for the file and retry the save request."
        })
      );
    }
    try {
      const result = this.settings.saveFile(body.kind, body.projectId ?? null, body.content, body.relativePath);
      publishWorkspaceStateChangedEvent({
        events: this.events,
        adminId: (req as Request & { authAdminId?: number }).authAdminId,
        surfaces: ["git", "projects", "settings"],
        projectSlug: body.projectId ?? null,
        reason: "opencode.settings.save"
      });
      return result;
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_SETTINGS_SAVE_FAILED",
          fallbackMessage: "Failed to save OpenCode settings file.",
          fallbackHint: "Check file permissions or runtime storage and retry the save."
        })
      );
    }
  }

  @Post("settings/create")
  public createSettingsFile(
    @Body() body: { kind?: OpenCodeSettingsKind; projectId?: string; name?: string },
    @Req() req: Request
  ) {
    /* Create one settings file in the target section. */
    if (!body?.kind) {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_OPENCODE_SETTINGS_KIND_REQUIRED",
          message: "Settings file kind is required.",
          hint: "Send a valid settings kind such as config, globalRule or projectEnvFile."
        })
      );
    }
    try {
      const result = this.settings.createFile(body.kind, body.projectId ?? null, body.name);
      publishWorkspaceStateChangedEvent({
        events: this.events,
        adminId: (req as Request & { authAdminId?: number }).authAdminId,
        surfaces: ["git", "projects", "settings"],
        projectSlug: body.projectId ?? null,
        reason: "opencode.settings.create"
      });
      return result;
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_SETTINGS_CREATE_FAILED",
          fallbackMessage: "Failed to create OpenCode settings file.",
          fallbackHint: "Check target folder permissions and retry file creation."
        })
      );
    }
  }
}
