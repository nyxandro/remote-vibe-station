/**
 * @fileoverview Admin-only HTTP controller for project selection.
 *
 * Why:
 * - Telegram bot authenticates via x-admin-id (AdminHeaderGuard).
 * - Mini App authenticates via initData or Bearer web token (AppAuthGuard).
 * - We keep these auth flows separate and explicit.
 *
 * Exports:
 * - ProjectsAdminController (L20) - Admin routes under /api/admin/projects.
 */

import { Controller, Get, Headers, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { AdminHeaderGuard } from "../security/admin-header.guard";
import { ProjectsService } from "./projects.service";

@Controller("api/admin/projects")
@UseGuards(AdminHeaderGuard)
export class ProjectsAdminController {
  public constructor(private readonly projects: ProjectsService) {}

  @Get()
  public async list() {
    /* Return discovered projects for admin. */
    return this.projects.list();
  }

  @Get("active")
  public async active(@Req() req: Request) {
    /* Return active project for this admin. */
    const adminId = (req as any).authAdminId as number | undefined;
    return this.projects.getActiveProject(adminId);
  }

  @Post(":id/select")
  public async select(
    @Param("id") id: string,
    @Headers("x-suppress-events") suppressEvents: string | undefined,
    @Req() req: Request
  ) {
    /* Select project for this admin; bot may suppress events. */
    const emitEvent = suppressEvents !== "1";
    const adminId = (req as any).authAdminId as number | undefined;
    return this.projects.selectProject(id, { emitEvent, adminId });
  }

  /* No additional routes. */
}
