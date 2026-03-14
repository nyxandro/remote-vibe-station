/**
 * @fileoverview App-authenticated HTTP endpoints for kanban board UI.
 *
 * Exports:
 * - KanbanController - CRUD, workflow, and secure-link routes for Mini App/browser board access.
 */

import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { EventsService } from "../events/events.service";
import { AppAuthGuard } from "../security/app-auth.guard";
import { KanbanValidationError } from "./kanban.errors";
import { KanbanService } from "./kanban.service";
import { publishKanbanTaskUpdated } from "./kanban-task-events";
import {
  KANBAN_CRITERION_STATUSES,
  KANBAN_PRIORITIES,
  KANBAN_STATUSES,
  KanbanCriterionInput,
  KanbanCriterionStatus,
  KanbanPriority,
  KanbanStatus
} from "./kanban.types";

@Controller("api/kanban")
@UseGuards(AppAuthGuard)
export class KanbanController {
  public constructor(
    private readonly kanban: KanbanService,
    private readonly events: EventsService
  ) {}

  private typeAuthRequest(request: Request): Request & { authAdminId?: number } {
    /* Keep controller code typed without sprinkling raw any-casts through auth-aware handlers. */
    return request as Request & { authAdminId?: number };
  }

  @Get("tasks")
  public async listTasks(
    @Query("projectSlug") projectSlug?: string,
    @Query("status") statusRaw?: string
  ) {
    /* Mini App reads project-scoped or global board state through one filtered list endpoint. */
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
    @Body()
      body: {
        title?: string;
        description?: string;
        status?: KanbanStatus;
        priority?: KanbanPriority;
        acceptanceCriteria?: KanbanCriterionInput[];
        resultSummary?: string | null;
        blockedReason?: string | null;
      }
  ) {
    /* Card editing reuses one patch route instead of many narrow field-specific endpoints. */
    try {
      const task = await this.kanban.updateTask(id, {
        ...(typeof body?.title === "string" ? { title: body.title } : {}),
        ...(typeof body?.description === "string" ? { description: body.description } : {}),
        ...(body?.status ? { status: this.parseRequiredStatus(body.status) } : {}),
        ...(body?.priority ? { priority: this.parseRequiredPriority(body.priority) } : {}),
        ...(Array.isArray(body?.acceptanceCriteria)
          ? { acceptanceCriteria: body.acceptanceCriteria }
          : {}),
        ...(body?.resultSummary !== undefined ? { resultSummary: body.resultSummary } : {}),
        ...(body?.blockedReason !== undefined ? { blockedReason: body.blockedReason } : {})
      });
      publishKanbanTaskUpdated(this.events, { task, source: "app" });
      return task;
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
      return await this.kanban.createBoardLink({ adminId, projectSlug: body?.projectSlug ?? null });
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

  private rethrowAsHttp(error: unknown): never {
    /* Only client-fixable kanban validation failures are converted to 400 responses. */
    if (error instanceof KanbanValidationError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
