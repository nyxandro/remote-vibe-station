/**
 * @fileoverview HTTP controller for project-scoped terminal snapshot and input routes.
 *
 * Exports:
 * - ProjectTerminalController - Serves project terminal hydration and input endpoints.
 * - snapshot - Handler for GET /api/projects/:id/terminal.
 * - sendInput - Handler for POST /api/projects/:id/terminal/input.
 */

import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";

import { AppAuthGuard } from "../security/app-auth.guard";
import { terminalInputRequiredError } from "./project-controller-errors";
import { ProjectTerminalService } from "./project-terminal.service";
import { ProjectsService } from "./projects.service";

@Controller("api/projects")
@UseGuards(AppAuthGuard)
export class ProjectTerminalController {
  public constructor(
    private readonly projects: ProjectsService,
    private readonly terminals: ProjectTerminalService
  ) {}

  @Get(":id/terminal")
  public async snapshot(@Param("id") id: string) {
    /* Hydrate terminal tab with the already-running PTY transcript so the initial shell prompt is visible immediately. */
    const rootPath = this.projects.getProjectRootPath(id);
    await this.terminals.ensure(id, rootPath);
    return { buffer: this.terminals.readSnapshot(id) };
  }

  @Post(":id/terminal/input")
  public async sendInput(@Param("id") id: string, @Body() body: { input?: string }) {
    /* Terminal writes stay explicit so malformed payloads cannot mutate the project PTY session. */
    if (!body || typeof body.input !== "string") {
      throw terminalInputRequiredError();
    }

    await this.projects.sendTerminalInput(id, body.input);
    return { ok: true };
  }
}
