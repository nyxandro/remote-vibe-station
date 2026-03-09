/**
 * @fileoverview Internal token-authenticated endpoints for OpenCode kanban plugin tools.
 *
 * Exports:
 * - KanbanAgentController - Agent-friendly task listing, refinement, claiming, and completion routes.
 */

import { BadRequestException, Body, Controller, Param, Post, UseGuards } from "@nestjs/common";

import { KanbanAgentGuard } from "../security/kanban-agent.guard";
import { KanbanValidationError } from "./kanban.errors";
import { KanbanService } from "./kanban.service";
import { KANBAN_PRIORITIES, KANBAN_STATUSES, KanbanPriority, KanbanStatus } from "./kanban.types";

@Controller("api/kanban/agent")
@UseGuards(KanbanAgentGuard)
export class KanbanAgentController {
  public constructor(private readonly kanban: KanbanService) {}

  @Post("list")
  public async listTasks(
    @Body()
    body: {
      projectSlug?: string | null;
      currentDirectory?: string | null;
      status?: KanbanStatus | null;
      limit?: number;
    }
  ) {
    /* Plugin tools pass current directory so backend can infer the active project automatically. */
    try {
      const tasks = await this.kanban.listTasks({
        projectSlug: body?.projectSlug ?? null,
        currentDirectory: body?.currentDirectory ?? null,
        status: body?.status ? this.parseStatus(body.status) : null,
        limit: typeof body?.limit === "number" ? body.limit : undefined
      });
      return { tasks };
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("create")
  public async createTask(
    @Body()
    body: {
      projectSlug?: string | null;
      currentDirectory?: string | null;
      title?: string;
      description?: string;
      status?: KanbanStatus;
      priority?: KanbanPriority;
      acceptanceCriteria?: string[];
    }
  ) {
    /* Agents can capture newly discussed work directly into backlog or queue without opening the UI. */
    if (typeof body?.title !== "string" || body.title.trim().length === 0) {
      throw new BadRequestException("title is required");
    }

    try {
      const projectSlug = await this.kanban.resolveProjectSlug({
        projectSlug: body?.projectSlug ?? null,
        currentDirectory: body?.currentDirectory ?? null,
        required: true
      });
      if (!projectSlug) {
        throw new BadRequestException("projectSlug is required");
      }

      return await this.kanban.createTask({
        projectSlug,
        title: body.title,
        description: body?.description ?? "",
        status: body?.status ? this.parseStatus(body.status) : "backlog",
        priority: body?.priority ? this.parsePriority(body.priority) : "medium",
        acceptanceCriteria: Array.isArray(body?.acceptanceCriteria) ? body.acceptanceCriteria : []
      });
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:id/refine")
  public async refineTask(
    @Param("id") id: string,
    @Body()
    body: {
      title?: string;
      description?: string;
      status?: KanbanStatus;
      priority?: KanbanPriority;
      acceptanceCriteria?: string[];
      resultSummary?: string | null;
      blockedReason?: string | null;
    }
  ) {
    /* One refine endpoint covers backlog discussion, scope updates, and queue transitions. */
    try {
      return await this.kanban.updateTask(id, {
        ...(typeof body?.title === "string" ? { title: body.title } : {}),
        ...(typeof body?.description === "string" ? { description: body.description } : {}),
        ...(body?.status ? { status: this.parseStatus(body.status) } : {}),
        ...(body?.priority ? { priority: this.parsePriority(body.priority) } : {}),
        ...(Array.isArray(body?.acceptanceCriteria)
          ? { acceptanceCriteria: body.acceptanceCriteria }
          : {}),
        ...(body?.resultSummary !== undefined ? { resultSummary: body.resultSummary } : {}),
        ...(body?.blockedReason !== undefined ? { blockedReason: body.blockedReason } : {})
      });
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("claim-next")
  public async claimNext(
    @Body()
    body: {
      agentId?: string;
      projectSlug?: string | null;
      currentDirectory?: string | null;
      leaseMs?: number;
    }
  ) {
    /* Claim next keeps agent workflow explicit and backend-arbitrated to avoid duplicate execution. */
    if (typeof body?.agentId !== "string" || body.agentId.trim().length === 0) {
      throw new BadRequestException("agentId is required");
    }

    try {
      return {
        task: await this.kanban.claimNextTask({
          agentId: body.agentId,
          projectSlug: body?.projectSlug ?? null,
          currentDirectory: body?.currentDirectory ?? null,
          leaseMs: typeof body?.leaseMs === "number" ? body.leaseMs : undefined
        })
      };
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:id/complete")
  public async completeTask(
    @Param("id") id: string,
    @Body() body: { resultSummary?: string | null }
  ) {
    /* Agent completion writes back a short outcome summary for humans reviewing the board. */
    try {
      return await this.kanban.completeTask({ taskId: id, resultSummary: body?.resultSummary });
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:id/block")
  public async blockTask(@Param("id") id: string, @Body() body: { reason?: string | null }) {
    /* Blocking preserves the exact dependency or ambiguity the agent could not resolve alone. */
    try {
      return await this.kanban.blockTask({ taskId: id, reason: body?.reason });
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  private parseStatus(value: string): KanbanStatus {
    /* Internal tool payloads are still validated because plugin bugs should fail loudly. */
    if (!KANBAN_STATUSES.includes(value as KanbanStatus)) {
      throw new KanbanValidationError("Valid kanban status is required");
    }
    return value as KanbanStatus;
  }

  private parsePriority(value: string): KanbanPriority {
    /* Priorities influence claim order, so agent-side typos must not silently degrade queue selection. */
    if (!KANBAN_PRIORITIES.includes(value as KanbanPriority)) {
      throw new KanbanValidationError("Valid kanban priority is required");
    }
    return value as KanbanPriority;
  }

  private rethrowAsHttp(error: unknown): never {
    /* Tool callers receive 400 only for fixable validation problems; unexpected failures stay 500. */
    if (error instanceof KanbanValidationError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
