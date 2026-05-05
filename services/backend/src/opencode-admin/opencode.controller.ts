/**
 * @fileoverview OpenCode integration endpoints.
 *
 * Exports:
 * - OpenCodeController - Routes for OpenCode-related actions.
 */

import { BadRequestException, Body, Controller, Delete, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { EventsService } from "../events/events.service";
import { publishWorkspaceStateChangedEvent } from "../events/workspace-events";
import { createAppErrorBody, normalizeUnknownErrorToAppError } from "../logging/app-error";
import { AppAuthGuard } from "../security/app-auth.guard";
import { OpenCodeProjectSyncService } from "./opencode-project-sync.service";
import { OpenCodeRuntimeService } from "./opencode-runtime.service";
import { OpenCodeSettingsKind, OpenCodeSettingsService } from "./opencode-settings.service";
import { OpenCodeSkillsService, SkillCatalogFilter } from "./opencode-skills.service";

@Controller("api/opencode")
@UseGuards(AppAuthGuard)
export class OpenCodeController {
  public constructor(
    private readonly sync: OpenCodeProjectSyncService,
    private readonly settings: OpenCodeSettingsService,
    private readonly skills: OpenCodeSkillsService,
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
    /* Force OpenCode toolbox update, then restart runtime so the fresh binary becomes active. */
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
          fallbackHint: "Check npm access and OpenCode runtime health, then retry the update."
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

  @Get("skills")
  public async searchSkills(
    @Query("q") query?: string,
    @Query("installed") installed?: SkillCatalogFilter
  ) {
    /* Search remote NeuralDeep catalog and mark skills already present in OpenCode config. */
    try {
      return await this.skills.searchCatalog({ query, installed: installed ?? "all" });
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_SKILLS_SEARCH_FAILED",
          fallbackMessage: "Failed to search OpenCode skills catalog.",
          fallbackHint: "Check outbound access to neuraldeep.ru and retry the search."
        })
      );
    }
  }

  @Get("skills/installed")
  public listInstalledSkills() {
    /* Return locally installed skills from the shared OpenCode config volume. */
    try {
      return this.skills.listInstalledSkills();
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_SKILLS_INSTALLED_FAILED",
          fallbackMessage: "Failed to list installed OpenCode skills.",
          fallbackHint: "Check OpenCode config volume permissions and retry."
        })
      );
    }
  }

  @Post("skills/install")
  public async installSkill(
    @Body() body: { id?: string; name?: string; owner?: string | null; repo?: string | null; version?: string | null },
    @Req() req: Request
  ) {
    /* Install selected NeuralDeep skill into ~/.config/opencode/skills and notify settings surfaces. */
    if (!body?.id || !body.name) {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_OPENCODE_SKILL_INSTALL_INPUT_REQUIRED",
          message: "Skill id and name are required for installation.",
          hint: "Select a skill from the catalog and retry installation."
        })
      );
    }

    try {
      const result = await this.skills.installSkill({
        id: body.id,
        name: body.name,
        owner: body.owner,
        repo: body.repo,
        version: body.version
      });
      publishWorkspaceStateChangedEvent({
        events: this.events,
        adminId: (req as Request & { authAdminId?: number }).authAdminId,
        surfaces: ["settings"],
        reason: "opencode.skills.install"
      });
      return result;
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_SKILL_INSTALL_FAILED",
          fallbackMessage: "Failed to install OpenCode skill.",
          fallbackHint: "Check the selected skill and OpenCode config volume permissions, then retry."
        })
      );
    }
  }

  @Delete("skills/uninstall")
  public async uninstallSkill(@Body() body: { name?: string }, @Req() req: Request) {
    /* Uninstall one local skill by folder name. */
    if (!body?.name) {
      throw new BadRequestException(
        createAppErrorBody({
          code: "APP_OPENCODE_SKILL_NAME_REQUIRED",
          message: "Skill name is required for removal.",
          hint: "Choose an installed skill and retry removal."
        })
      );
    }

    try {
      const result = await this.skills.uninstallSkill(body.name);
      publishWorkspaceStateChangedEvent({
        events: this.events,
        adminId: (req as Request & { authAdminId?: number }).authAdminId,
        surfaces: ["settings"],
        reason: "opencode.skills.uninstall"
      });
      return result;
    } catch (error) {
      throw new BadRequestException(
        normalizeUnknownErrorToAppError({
          error,
          fallbackCode: "APP_OPENCODE_SKILL_UNINSTALL_FAILED",
          fallbackMessage: "Failed to remove OpenCode skill.",
          fallbackHint: "Check the skill name and OpenCode config volume permissions, then retry."
        })
      );
    }
  }
}
