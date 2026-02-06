/**
 * @fileoverview OpenCode integration endpoints.
 *
 * Exports:
 * - OpenCodeController (L17) - Routes for OpenCode-related actions.
 */

import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";

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
    private readonly runtime: OpenCodeRuntimeService
  ) {}

  @Post("sync-projects")
  public async syncProjects() {
    /* Sync PROJECTS_ROOT folders into OpenCode storage (best-effort hack). */
    return this.sync.sync();
  }

  @Post("warm-recents")
  public async warmRecents() {
    /* Populate OpenCode "recent projects" by opening directories once. */
    return this.sync.warmRecents();
  }

  @Post("restart")
  public async restartOpenCode() {
    /* Restart OpenCode containers so config/rules changes are reloaded. */
    try {
      return await this.runtime.restartServiceContainers();
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Unknown error");
    }
  }

  @Get("settings/overview")
  public getSettingsOverview(@Query("projectId") projectId?: string) {
    /* Read all OpenCode settings sections for accordion rendering. */
    try {
      return this.settings.getOverview(projectId ?? null);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Unknown error");
    }
  }

  @Post("settings/read")
  public readSettingsFile(
    @Body() body: { kind?: OpenCodeSettingsKind; projectId?: string; relativePath?: string }
  ) {
    /* Read one settings file by section kind. */
    if (!body?.kind) {
      throw new BadRequestException("kind is required");
    }
    try {
      return this.settings.readFile(body.kind, body.projectId ?? null, body.relativePath);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Unknown error");
    }
  }

  @Post("settings/save")
  public saveSettingsFile(
    @Body()
    body: { kind?: OpenCodeSettingsKind; projectId?: string; relativePath?: string; content?: string }
  ) {
    /* Save one settings file by section kind. */
    if (!body?.kind) {
      throw new BadRequestException("kind is required");
    }
    if (typeof body.content !== "string") {
      throw new BadRequestException("content is required");
    }
    try {
      return this.settings.saveFile(body.kind, body.projectId ?? null, body.content, body.relativePath);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Unknown error");
    }
  }

  @Post("settings/create")
  public createSettingsFile(
    @Body() body: { kind?: OpenCodeSettingsKind; projectId?: string; name?: string }
  ) {
    /* Create one settings file in the target section. */
    if (!body?.kind) {
      throw new BadRequestException("kind is required");
    }
    try {
      return this.settings.createFile(body.kind, body.projectId ?? null, body.name);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Unknown error");
    }
  }
}
