/**
 * @fileoverview App-authenticated HTTP endpoints for kanban board UI.
 *
 * Exports:
 * - KanbanController - CRUD, workflow, and secure-link routes for Mini App/browser board access.
 */

import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { AppConfig, ConfigToken } from "../config/config.types";
import { EventsService } from "../events/events.service";
import { isUnsafeLocalRequestAllowed } from "../security/local-dev-auth";
import { AppAuthGuard } from "../security/app-auth.guard";
import { KanbanValidationError } from "./kanban.errors";
import { KanbanService } from "./kanban.service";
import { publishKanbanTaskDeleted, publishKanbanTaskUpdated } from "./kanban-task-events";
import {
  KANBAN_CRITERION_STATUSES,
  KANBAN_PRIORITIES,
  KANBAN_STATUSES,
  KanbanCriterionInput,
  KanbanCriterionStatus,
  KanbanPriority,
  KanbanStatus,
  UpdateKanbanTaskInput
} from "./kanban.types";

type AppTaskUpdateBody = {
  title?: string;
  description?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  acceptanceCriteria?: KanbanCriterionInput[];
  clearAcceptanceCriteria?: boolean;
  resultSummary?: string | null;
  blockedReason?: string | null;
};

@Controller("api/kanban")
@UseGuards(AppAuthGuard)
export class KanbanController {
  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly kanban: KanbanService,
    private readonly events: EventsService
  ) {}

  private typeAuthRequest(request: Request): Request & { authAdminId?: number } {
    /* Keep controller code typed without sprinkling raw any-casts through auth-aware handlers. */
    return request as Request & { authAdminId?: number };
  }

  private resolveLocalBoardOrigin(request: Request): string | null {
    /* Local dev should open shared boards inside the same localhost origin instead of bouncing to the remote public domain. */
    if (!isUnsafeLocalRequestAllowed({ request, config: this.config })) {
      return null;
    }

    const host = typeof request.headers?.host === "string" ? request.headers.host.trim() : "";
    if (!host) {
      return null;
    }

    /* Browser-facing miniapp proxy already terminates local HTTP, so request.protocol is the right origin for local debugging. */
    const protocol = request.protocol || "http";
    return `${protocol}://${host}`;
  }

  @Get("tasks")
  public async listTasks(
    @Query("projectSlug") projectSlug?: string,
    @Query("status") statusRaw?: string
  ) {
    /* Mini App reads project-scoped or global board state through one filtered list endpoint. */
    console.log(`[KanbanController] listTasks: projectSlug=${projectSlug}, statusRaw=${statusRaw}`);
    try {
      return await this.kanban.listTasks({
        projectSlug: projectSlug ?? null,
        status: this.parseOptionalStatus(statusRaw)
      });
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks")
  public async createTask(
    @Body()
      body: {
        projectSlug?: string;
        title?: string;
        description?: string;
        status?: KanbanStatus;
        priority?: KanbanPriority;
        acceptanceCriteria?: KanbanCriterionInput[];
      }
  ) {
    /* Task creation stays explicit so cards are always tied to a concrete project + workflow state. */
    console.log(`[KanbanController] createTask: body=${JSON.stringify(body)}`);
    if (typeof body?.projectSlug !== "string" || body.projectSlug.trim().length === 0) {
      throw new BadRequestException("projectSlug is required");
    }
    if (typeof body?.title !== "string" || body.title.trim().length === 0) {
      throw new BadRequestException("title is required");
    }

    try {
      const task = await this.kanban.createTask({
        projectSlug: body.projectSlug,
        title: body.title,
        description: body?.description ?? "",
        status: this.parseRequiredStatus(body?.status),
        priority: this.parseRequiredPriority(body?.priority),
        acceptanceCriteria: Array.isArray(body?.acceptanceCriteria) ? body.acceptanceCriteria : []
      });
      publishKanbanTaskUpdated(this.events, { task, source: "app" });
      return task;
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:id/update")
  public async updateTask(
    @Param("id") id: string,
    @Body() body: AppTaskUpdateBody
  ) {
    /* Card editing reuses one patch route instead of many narrow field-specific endpoints. */
    console.log(`[KanbanController] updateTask: id=${id}, body=${JSON.stringify(body)}`);
    try {
      const task = await this.kanban.updateTask(id, this.buildTaskUpdatePatch(body));
      publishKanbanTaskUpdated(this.events, { task, source: "app" });
      return task;
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Delete("tasks/:id")
  public async deleteTask(@Param("id") id: string) {
    /* User-controlled deletion is intentionally app-only so agents cannot erase backlog history mid-execution. */
    try {
      const task = await this.kanban.deleteTask(id);
      publishKanbanTaskDeleted(this.events, { task, source: "app" });
      return { ok: true };
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:taskId/criteria/:criterionId/update")
  public async updateCriterion(
    @Param("taskId") taskId: string,
    @Param("criterionId") criterionId: string,
    @Body() body: { status: KanbanCriterionStatus; blockedReason?: string | null }
  ) {
    /* Criterion-level progress updates let humans and automation share the same completion checklist. */
    try {
      const task = await this.kanban.updateCriterion({
        taskId,
        criterionId,
        status: this.parseRequiredCriterionStatus(body?.status),
        blockedReason: body?.blockedReason
      });
      publishKanbanTaskUpdated(this.events, { task, source: "app" });
      return task;
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:id/move")
  public async moveTask(@Param("id") id: string, @Body() body: { status?: KanbanStatus }) {
    /* Drag-and-drop uses a small dedicated route to keep status changes obvious in network traces. */
    try {
      const task = await this.kanban.moveTask(id, this.parseRequiredStatus(body?.status));
      publishKanbanTaskUpdated(this.events, { task, source: "app" });
      return task;
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:id/complete")
  public async completeTask(
    @Param("id") id: string,
    @Body() body: { resultSummary?: string | null }
  ) {
    /* Done transition stores the final implementation summary shown on the card. */
    try {
      const task = await this.kanban.completeTask({ taskId: id, resultSummary: body?.resultSummary });
      publishKanbanTaskUpdated(this.events, { task, source: "app" });
      return task;
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:id/block")
  public async blockTask(@Param("id") id: string, @Body() body: { reason?: string | null }) {
    /* Blocked transition requires explicit context so humans know what to fix next. */
    try {
      const task = await this.kanban.blockTask({ taskId: id, reason: body?.reason });
      publishKanbanTaskUpdated(this.events, { task, source: "app" });
      return task;
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("board-link")
  public async createBoardLink(
    @Body() body: { projectSlug?: string | null },
    @Req() req: Request
  ) {
    /* Browser board links are minted per authenticated admin and optionally pre-filter to one project. */
    const adminId = this.typeAuthRequest(req).authAdminId;
    if (!adminId) {
      throw new UnauthorizedException("Admin identity missing");
    }

    try {
      return await this.kanban.createBoardLink({
        adminId,
        projectSlug: body?.projectSlug ?? null,
        localDevOrigin: this.resolveLocalBoardOrigin(req)
      });
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  private parseOptionalStatus(value?: string): KanbanStatus | null {
    /* Optional query filters stay nullable when no status is requested. */
    if (!value) {
      return null;
    }
    return this.parseRequiredStatus(value as KanbanStatus);
  }

  private parseRequiredStatus(value?: string): KanbanStatus {
    /* Reject unknown statuses early so malformed UI requests never reach the store. */
    if (!value || !KANBAN_STATUSES.includes(value as KanbanStatus)) {
      throw new KanbanValidationError("Valid kanban status is required");
    }
    return value as KanbanStatus;
  }

  private parseRequiredPriority(value?: string): KanbanPriority {
    /* Priorities stay explicit because queue ordering depends on them. */
    if (!value || !KANBAN_PRIORITIES.includes(value as KanbanPriority)) {
      throw new KanbanValidationError("Valid kanban priority is required");
    }
    return value as KanbanPriority;
  }

  private parseRequiredCriterionStatus(value?: string): KanbanCriterionStatus {
    /* Criterion state changes stay explicit so task completion rules remain deterministic. */
    if (!value || !KANBAN_CRITERION_STATUSES.includes(value as KanbanCriterionStatus)) {
      throw new KanbanValidationError("Valid kanban criterion status is required");
    }
    return value as KanbanCriterionStatus;
  }

  private buildTaskUpdatePatch(body: AppTaskUpdateBody): UpdateKanbanTaskInput {
    /* Empty arrays from clients often mean "unchanged", but an explicit clear flag must still wipe the checklist. */
    const shouldReplaceAcceptanceCriteria =
      body.clearAcceptanceCriteria === true ||
      (Array.isArray(body.acceptanceCriteria) && body.acceptanceCriteria.length > 0);

    return {
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(body.status ? { status: this.parseRequiredStatus(body.status) } : {}),
      ...(body.priority ? { priority: this.parseRequiredPriority(body.priority) } : {}),
      ...(shouldReplaceAcceptanceCriteria ? { acceptanceCriteria: body.acceptanceCriteria ?? [] } : {}),
      ...(body.resultSummary !== undefined ? { resultSummary: body.resultSummary } : {}),
      ...(body.blockedReason !== undefined ? { blockedReason: body.blockedReason } : {})
    };
  }

  private rethrowAsHttp(error: unknown): never {
    /* Only client-fixable kanban validation failures are converted to 400 responses. */
    if (error instanceof KanbanValidationError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
