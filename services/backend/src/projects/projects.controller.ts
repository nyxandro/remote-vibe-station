/**
 * @fileoverview HTTP controller for project operations.
 *
 * Exports:
 * - ProjectsController (L23) - CRUD and lifecycle endpoints for projects.
 * - validatePayload (L26) - Validate project creation payload.
 * - list (L42) - Handler for GET /api/projects.
 * - register (L48) - Handler for POST /api/projects.
 * - start (L59) - Handler for POST /api/projects/:id/start.
 * - stop (L65) - Handler for POST /api/projects/:id/stop.
 * - restart (L71) - Handler for POST /api/projects/:id/restart.
 * - status (L77) - Handler for GET /api/projects/:id/status.
 * - logs (L83) - Handler for GET /api/projects/:id/logs.
 * - gitSummary (L160) - Handler for GET /api/projects/:id/git-summary.
 */

import { Body, Controller, Get, Headers, Logger, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { AppAuthGuard } from "../security/app-auth.guard";
import { ProjectGitOpsService } from "./project-git-ops.service";
import { ProjectDeploymentService } from "./project-deployment.service";
import { ProjectGitService } from "./project-git.service";
import { publishProjectLifecycleEvent } from "./project-lifecycle-events";
import { ProjectWorkspaceService } from "./project-workspace.service";
import {
  branchRequiredError,
  commitMessageRequiredError,
  createProjectsControllerBadRequest,
  deployPatchRequiredError,
  filePathRequiredError,
  projectNameRequiredError,
  projectPayloadInvalidError,
  repositoryUrlRequiredError,
  sourceBranchRequiredError,
  terminalInputRequiredError,
  unsupportedContainerActionError
} from "./project-controller-errors";
import { ProjectCreateRequest } from "./project.types";
import { ProjectsService } from "./projects.service";
import { EventsService } from "../events/events.service";
import { ProjectRuntimeSettingsPatch } from "./project-runtime.types";

@Controller("api/projects")
@UseGuards(AppAuthGuard)
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  public constructor(
    private readonly projects: ProjectsService,
    private readonly gitSummaryService: ProjectGitService,
    private readonly gitOps: ProjectGitOpsService,
    private readonly deployment: ProjectDeploymentService,
    private readonly workspace: ProjectWorkspaceService,
    private readonly events: EventsService
  ) {}

  private validatePayload(body: ProjectCreateRequest): void {
    /* Validate required fields and types. */
    const hasStrings =
      typeof body.name === "string" &&
      typeof body.slug === "string" &&
      typeof body.rootPath === "string" &&
      typeof body.composePath === "string" &&
      typeof body.serviceName === "string";
    const hasPort = typeof body.servicePort === "number" && Number.isFinite(body.servicePort);

    if (!hasStrings || !hasPort) {
      throw projectPayloadInvalidError();
    }
  }

  @Get()
  public async list() {
    /* Return discovered projects enriched with deploy links for expandable Mini App cards. */
    const items = await this.projects.list();

    return Promise.all(
      items.map(async (item) => {
        /* Keep projects list resilient when one runtime snapshot is temporarily unavailable. */
        try {
          const runtime = await this.deployment.getRuntimeSnapshot(item.slug);
          return {
            ...item,
            deploy: {
              previewUrl: runtime.previewUrl,
              deployed: runtime.deployed,
              routes: runtime.routes.map((route) => ({
                id: route.id,
                previewUrl: route.previewUrl,
                subdomain: route.subdomain,
                pathPrefix: route.pathPrefix
              }))
            }
          };
        } catch (error) {
          /* Log and keep the base project card usable instead of failing the whole response. */
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Failed to load deploy snapshot for project ${item.slug}: ${message}`);
          return item;
        }
      })
    );
  }

  @Get("active")
  public async active(@Req() req: Request) {
    /* Return currently selected project (if any). */
    const adminId = (req as any).authAdminId as number | undefined;
    return this.projects.getActiveProject(adminId);
  }

  @Post()
  public async register(@Body() body: ProjectCreateRequest) {
    /* Delegate to registry after basic validation. */
    if (!body) {
      throw projectPayloadInvalidError();
    }

    this.validatePayload(body);
    return this.projects.registerProject(body);
  }

  @Post("create-folder")
  public async createFolder(@Body() body: { name?: string }) {
    /* Create empty project folder under PROJECTS_ROOT. */
    const name = body?.name?.trim();
    if (!name) {
      throw projectNameRequiredError();
    }

    try {
      return this.workspace.createProjectFolder(name);
    } catch (error) {
      throw createProjectsControllerBadRequest({
        error,
        fallbackCode: "APP_PROJECT_FOLDER_CREATE_FAILED",
        fallbackMessage: "Failed to create project folder.",
        fallbackHint: "Check target path permissions and retry project folder creation."
      });
    }
  }

  @Post("clone")
  public async clone(@Body() body: { repositoryUrl?: string; folderName?: string }) {
    /* Clone repository into PROJECTS_ROOT with optional folder override. */
    const repositoryUrl = body?.repositoryUrl?.trim();
    if (!repositoryUrl) {
      throw repositoryUrlRequiredError();
    }

    try {
      return await this.workspace.cloneRepository({ repositoryUrl, folderName: body?.folderName });
    } catch (error) {
      throw createProjectsControllerBadRequest({
        error,
        fallbackCode: "APP_PROJECT_CLONE_FAILED",
        fallbackMessage: "Failed to clone repository into projects workspace.",
        fallbackHint: "Check repository URL, git credentials and target folder, then retry the clone."
      });
    }
  }

  @Post(":id/start")
  public async start(@Param("id") id: string, @Req() req: Request) {
    /* Start project containers. */
    const adminId = (req as any).authAdminId as number | undefined;
    const result = await this.projects.startProject(id);
    void publishProjectLifecycleEvent({ projects: this.projects, events: this.events, adminId, slug: id, action: "start" });
    return result;
  }

  @Post(":id/select")
  public async select(
    @Param("id") id: string,
    @Headers("x-suppress-events") suppressEvents: string | undefined,
    @Req() req: Request
  ) {
    /* Persist active project selection for the UI/bot routing. */
    const emitEvent = suppressEvents !== "1";
    const adminId = (req as any).authAdminId as number | undefined;
    return this.projects.selectProject(id, { emitEvent, adminId });
  }

  @Post(":id/delete")
  public async deleteProject(@Param("id") id: string) {
    /* Delete local project folder when delete policy allows it. */
    try {
      return await this.workspace.deleteProjectFolder(id);
    } catch (error) {
      throw createProjectsControllerBadRequest({
        error,
        fallbackCode: "APP_PROJECT_DELETE_FAILED",
        fallbackMessage: "Failed to delete local project folder.",
        fallbackHint: "Check delete policy, git status and filesystem permissions, then retry deletion."
      });
    }
  }

  @Post(":id/stop")
  public async stop(@Param("id") id: string, @Req() req: Request) {
    /* Stop project containers. */
    const adminId = (req as any).authAdminId as number | undefined;
    const result = await this.projects.stopProject(id);
    void publishProjectLifecycleEvent({ projects: this.projects, events: this.events, adminId, slug: id, action: "stop" });
    return result;
  }

  @Post(":id/restart")
  public async restart(@Param("id") id: string, @Req() req: Request) {
    /* Restart project containers. */
    const adminId = (req as any).authAdminId as number | undefined;
    const result = await this.projects.restartProject(id);
    void publishProjectLifecycleEvent({ projects: this.projects, events: this.events, adminId, slug: id, action: "restart" });
    return result;
  }

  @Get(":id/deploy/settings")
  public async getDeploySettings(@Param("id") id: string) {
    /* Return project deploy settings snapshot used by Mini App settings panel. */
    try {
      return await this.deployment.getRuntimeSnapshot(id);
    } catch (error) {
      throw createProjectsControllerBadRequest({
        error,
        fallbackCode: "APP_PROJECT_DEPLOY_SETTINGS_READ_FAILED",
        fallbackMessage: "Failed to read project deploy settings.",
        fallbackHint: "Check deployment settings storage and retry loading project deploy settings."
      });
    }
  }

  @Post(":id/deploy/settings")
  public async updateDeploySettings(@Param("id") id: string, @Body() body: ProjectRuntimeSettingsPatch) {
    /* Persist project deploy settings from Mini App Project settings accordion. */
    const hasPatch =
      typeof body === "object" &&
      body !== null &&
      ("mode" in body || "serviceName" in body || "internalPort" in body || "staticRoot" in body || "routes" in body);
    if (!hasPatch) {
      throw deployPatchRequiredError();
    }

    try {
      return await this.deployment.updateRuntimeSettings(id, body);
    } catch (error) {
      throw createProjectsControllerBadRequest({
        error,
        fallbackCode: "APP_PROJECT_DEPLOY_SETTINGS_UPDATE_FAILED",
        fallbackMessage: "Failed to update project deploy settings.",
        fallbackHint: "Check runtime mode fields/routes and retry saving deploy settings."
      });
    }
  }

  @Post(":id/deploy/start")
  public async startDeploy(@Param("id") id: string) {
    /* Start external deployment endpoint for selected project domain. */
    try {
      return await this.deployment.startDeployment(id);
    } catch (error) {
      throw createProjectsControllerBadRequest({
        error,
        fallbackCode: "APP_PROJECT_DEPLOY_START_FAILED",
        fallbackMessage: "Failed to start project deployment.",
        fallbackHint: "Check deploy settings and runtime availability, then retry deployment start."
      });
    }
  }

  @Post(":id/deploy/autoconfigure")
  public async autoConfigureDeploy(@Param("id") id: string) {
    /* Agent-oriented helper infers common public routes before first deploy on remote dev VDS. */
    try {
      return await this.deployment.autoConfigureDeployment(id);
    } catch (error) {
      throw createProjectsControllerBadRequest({
        error,
        fallbackCode: "APP_PROJECT_DEPLOY_AUTOCONFIG_FAILED",
        fallbackMessage: "Failed to autoconfigure project deployment routes.",
        fallbackHint: "Check compose/runtime metadata and retry deployment autoconfiguration."
      });
    }
  }

  @Post(":id/deploy/stop")
  public async stopDeploy(@Param("id") id: string) {
    /* Stop external deployment endpoint for selected project domain. */
    try {
      return await this.deployment.stopDeployment(id);
    } catch (error) {
      throw createProjectsControllerBadRequest({
        error,
        fallbackCode: "APP_PROJECT_DEPLOY_STOP_FAILED",
        fallbackMessage: "Failed to stop project deployment.",
        fallbackHint: "Check runtime availability and retry deployment stop."
      });
    }
  }

  @Post(":id/containers/:service/:action")
  public async containerAction(
    @Param("id") id: string,
    @Param("service") service: string,
    @Param("action") action: string,
    @Req() req: Request
  ) {
    /* Execute lifecycle action for one compose service. */
    if (action !== "start" && action !== "stop" && action !== "restart") {
      throw unsupportedContainerActionError(action);
    }

    const adminId = (req as any).authAdminId as number | undefined;
    await this.projects.runContainerAction(id, service, action);
    let status: unknown;
    try {
      status = await this.projects.statusProject(id);
    } catch {
      /* Action may succeed even if ps parsing fails; still notify. */
      status = [];
    }
    this.events.publish({
      type: "project.lifecycle",
      ts: new Date().toISOString(),
      data: {
        adminId: adminId ?? null,
        slug: id,
        action,
        containers: status
      }
    });
    return status;
  }

  @Get(":id/status")
  public async status(@Param("id") id: string) {
    /* Return status of project containers. */
    try {
      return await this.projects.statusProject(id);
    } catch {
      /*
       * Status is polled frequently by Mini App and should degrade gracefully.
       * Returning an empty list prevents noisy 400 loops for transient compose/env issues.
       */
      return [];
    }
  }

  @Get(":id/files")
  public async files(@Param("id") id: string, @Query("path") relativePath?: string) {
    /* List file tree entries for a project directory. */
    return this.projects.listFiles(id, relativePath);
  }

  @Get(":id/file")
  public async file(@Param("id") id: string, @Query("path") relativePath?: string) {
    /* Read text file content for previewing in Mini App. */
    if (!relativePath) {
      throw filePathRequiredError();
    }
    return this.projects.readFile(id, relativePath);
  }

  @Post(":id/terminal/input")
  public async terminal(@Param("id") id: string, @Body() body: { input?: string }) {
    /* Send input to a project-scoped terminal session. */
    if (!body || typeof body.input !== "string") {
      throw terminalInputRequiredError();
    }

    await this.projects.sendTerminalInput(id, body.input);
    return { ok: true };
  }

  @Get(":id/logs")
  public async logs(@Param("id") id: string) {
    /* Return recent project logs. */
    try {
      return await this.projects.logsProject(id);
    } catch (error) {
      throw createProjectsControllerBadRequest({
        error,
        fallbackCode: "APP_PROJECT_LOGS_READ_FAILED",
        fallbackMessage: "Failed to read project logs.",
        fallbackHint: "Check compose/runtime availability and retry loading project logs."
      });
    }
  }

  @Get(":id/git-summary")
  public async gitSummary(@Param("id") id: string) {
    /* Return active branch plus local git counters for project card badges. */
    try {
      const rootPath = this.projects.getProjectRootPath(id);
      return await this.gitSummaryService.summaryForProjectRoot(rootPath);
    } catch (error) {
      throw createProjectsControllerBadRequest({
        error,
        fallbackCode: "APP_PROJECT_GIT_SUMMARY_FAILED",
        fallbackMessage: "Failed to read git summary for project.",
        fallbackHint: "Check repository state and retry the git summary request."
      });
    }
  }

  @Get(":id/git/overview")
  public async gitOverview(@Param("id") id: string) {
    /* Return git branch and changed-file overview for project. */
    try {
      const rootPath = this.projects.getProjectRootPath(id);
      return await this.gitOps.getOverview(rootPath);
    } catch (error) {
      throw createProjectsControllerBadRequest({
        error,
        fallbackCode: "APP_PROJECT_GIT_OVERVIEW_FAILED",
        fallbackMessage: "Failed to read git overview for project.",
        fallbackHint: "Check repository state and retry the git overview request."
      });
    }
  }

  @Post(":id/git/checkout")
  public async gitCheckout(@Param("id") id: string, @Body() body: { branch?: string }) {
    /* Switch active branch for selected project repository. */
    if (!body?.branch || typeof body.branch !== "string") {
      throw branchRequiredError();
    }

    const rootPath = this.projects.getProjectRootPath(id);
    await this.gitOps.checkoutBranch(rootPath, body.branch);
    return this.gitOps.getOverview(rootPath);
  }

  @Post(":id/git/fetch")
  public async gitFetch(@Param("id") id: string) {
    /* Fetch remote refs and return updated overview. */
    const rootPath = this.projects.getProjectRootPath(id);
    await this.gitOps.fetchAll(rootPath);
    return this.gitOps.getOverview(rootPath);
  }

  @Post(":id/git/pull")
  public async gitPull(@Param("id") id: string) {
    /* Pull updates and return updated overview. */
    const rootPath = this.projects.getProjectRootPath(id);
    await this.gitOps.pull(rootPath);
    return this.gitOps.getOverview(rootPath);
  }

  @Post(":id/git/push")
  public async gitPush(@Param("id") id: string) {
    /* Push branch and return updated overview. */
    const rootPath = this.projects.getProjectRootPath(id);
    await this.gitOps.push(rootPath);
    return this.gitOps.getOverview(rootPath);
  }

  @Post(":id/git/merge")
  public async gitMerge(@Param("id") id: string, @Body() body: { sourceBranch?: string }) {
    /* Merge source branch into current branch and return overview. */
    if (!body?.sourceBranch || typeof body.sourceBranch !== "string") {
      throw sourceBranchRequiredError();
    }

    const rootPath = this.projects.getProjectRootPath(id);
    await this.gitOps.merge(rootPath, body.sourceBranch);
    return this.gitOps.getOverview(rootPath);
  }

  @Post(":id/git/commit")
  public async gitCommit(@Param("id") id: string, @Body() body: { message?: string }) {
    /* Commit all pending changes with required commit message. */
    const message = body?.message?.trim();
    if (!message) {
      throw commitMessageRequiredError();
    }

    const rootPath = this.projects.getProjectRootPath(id);
    await this.gitOps.commitAll(rootPath, message);
    return this.gitOps.getOverview(rootPath);
  }
}
