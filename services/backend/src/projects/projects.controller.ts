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

import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { AppAuthGuard } from "../security/app-auth.guard";
import { ProjectGitOpsService } from "./project-git-ops.service";
import { ProjectGitService } from "./project-git.service";
import { ProjectWorkspaceService } from "./project-workspace.service";
import { ProjectCreateRequest } from "./project.types";
import { ProjectsService } from "./projects.service";

@Controller("api/projects")
@UseGuards(AppAuthGuard)
export class ProjectsController {
  public constructor(
    private readonly projects: ProjectsService,
    private readonly gitSummaryService: ProjectGitService,
    private readonly gitOps: ProjectGitOpsService,
    private readonly workspace: ProjectWorkspaceService
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
      throw new BadRequestException("Invalid project payload");
    }
  }

  @Get()
  public async list() {
    /* Return discovered projects (folder-based). */
    return this.projects.list();
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
      throw new BadRequestException("Invalid project payload");
    }

    this.validatePayload(body);
    return this.projects.registerProject(body);
  }

  @Post("create-folder")
  public async createFolder(@Body() body: { name?: string }) {
    /* Create empty project folder under PROJECTS_ROOT. */
    const name = body?.name?.trim();
    if (!name) {
      throw new BadRequestException("Project name is required");
    }

    try {
      return this.workspace.createProjectFolder(name);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Unknown error");
    }
  }

  @Post("clone")
  public async clone(@Body() body: { repositoryUrl?: string; folderName?: string }) {
    /* Clone repository into PROJECTS_ROOT with optional folder override. */
    const repositoryUrl = body?.repositoryUrl?.trim();
    if (!repositoryUrl) {
      throw new BadRequestException("Repository URL is required");
    }

    try {
      return await this.workspace.cloneRepository({ repositoryUrl, folderName: body?.folderName });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Unknown error");
    }
  }

  @Post(":id/start")
  public async start(@Param("id") id: string) {
    /* Start project containers. */
    return this.projects.startProject(id);
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
      throw new BadRequestException(error instanceof Error ? error.message : "Unknown error");
    }
  }

  @Post(":id/stop")
  public async stop(@Param("id") id: string) {
    /* Stop project containers. */
    return this.projects.stopProject(id);
  }

  @Post(":id/restart")
  public async restart(@Param("id") id: string) {
    /* Restart project containers. */
    return this.projects.restartProject(id);
  }

  @Post(":id/containers/:service/:action")
  public async containerAction(
    @Param("id") id: string,
    @Param("service") service: string,
    @Param("action") action: string
  ) {
    /* Execute lifecycle action for one compose service. */
    if (action !== "start" && action !== "stop" && action !== "restart") {
      throw new BadRequestException(`Unsupported container action: ${action}`);
    }

    await this.projects.runContainerAction(id, service, action);
    return this.projects.statusProject(id);
  }

  @Get(":id/status")
  public async status(@Param("id") id: string) {
    /* Return status of project containers. */
    try {
      return await this.projects.statusProject(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
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
      throw new BadRequestException("File path is required");
    }
    return this.projects.readFile(id, relativePath);
  }

  @Post(":id/terminal/input")
  public async terminal(@Param("id") id: string, @Body() body: { input?: string }) {
    /* Send input to a project-scoped terminal session. */
    if (!body || typeof body.input !== "string") {
      throw new BadRequestException("Terminal input is required");
    }

    this.projects.sendTerminalInput(id, body.input);
    return { ok: true };
  }

  @Get(":id/logs")
  public async logs(@Param("id") id: string) {
    /* Return recent project logs. */
    try {
      return await this.projects.logsProject(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @Get(":id/git-summary")
  public async gitSummary(@Param("id") id: string) {
    /* Return uncommitted git summary for project card badges. */
    try {
      const rootPath = this.projects.getProjectRootPath(id);
      return await this.gitSummaryService.summaryForProjectRoot(rootPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @Get(":id/git/overview")
  public async gitOverview(@Param("id") id: string) {
    /* Return git branch and changed-file overview for project. */
    try {
      const rootPath = this.projects.getProjectRootPath(id);
      return await this.gitOps.getOverview(rootPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @Post(":id/git/checkout")
  public async gitCheckout(@Param("id") id: string, @Body() body: { branch?: string }) {
    /* Switch active branch for selected project repository. */
    if (!body?.branch || typeof body.branch !== "string") {
      throw new BadRequestException("Branch is required");
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
      throw new BadRequestException("Source branch is required");
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
      throw new BadRequestException("Commit message is required");
    }

    const rootPath = this.projects.getProjectRootPath(id);
    await this.gitOps.commitAll(rootPath, message);
    return this.gitOps.getOverview(rootPath);
  }
}
