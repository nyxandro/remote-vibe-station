/**
 * @fileoverview Internal token-authenticated endpoints for OpenCode kanban plugin tools.
 *
 * Exports:
 * - KanbanAgentController - Agent-friendly task listing, refinement, claiming, and completion routes.
 */

import { BadRequestException, Body, ConflictException, Controller, Param, Post, UseGuards } from "@nestjs/common";

import { EventsService } from "../events/events.service";
import { KanbanAgentGuard } from "../security/kanban-agent.guard";
import { KanbanExecutionConflictError, KanbanValidationError } from "./kanban.errors";
import { KanbanExecutionActor } from "./kanban-execution-ownership";
import { KanbanService } from "./kanban.service";
import { publishKanbanTaskUpdated } from "./kanban-task-events";
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

const DEFAULT_SESSION_AGENT_ID = "opencode-agent";

type AgentTaskRefineBody = {
  agentId?: string;
  sessionId?: string;
  title?: string;
  description?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  acceptanceCriteria?: KanbanCriterionInput[];
  clearAcceptanceCriteria?: boolean;
  resultSummary?: string | null;
  blockedReason?: string | null;
};

@Controller("api/kanban/agent")
@UseGuards(KanbanAgentGuard)
export class KanbanAgentController {
  public constructor(
    private readonly kanban: KanbanService,
    private readonly events: EventsService
  ) {}

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
      acceptanceCriteria?: KanbanCriterionInput[];
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

      const task = await this.kanban.createTask({
        projectSlug,
        title: body.title,
        description: body?.description ?? "",
        status: body?.status ? this.parseStatus(body.status) : "backlog",
        priority: body?.priority ? this.parsePriority(body.priority) : "medium",
        acceptanceCriteria: Array.isArray(body?.acceptanceCriteria) ? body.acceptanceCriteria : []
      });
      publishKanbanTaskUpdated(this.events, { task, source: "agent" });
      return task;
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:id/refine")
  public async refineTask(
    @Param("id") id: string,
    @Body() body: AgentTaskRefineBody
  ) {
    /* Starting a task through the agent endpoint must claim session ownership atomically before extra edits apply. */
    try {
      const task = await this.updateTaskForAgent(id, body);
      publishKanbanTaskUpdated(this.events, { task, source: "agent" });
      return task;
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:taskId/criteria/:criterionId/update")
  public async updateCriterion(
    @Param("taskId") taskId: string,
    @Param("criterionId") criterionId: string,
    @Body() body: { agentId?: string; sessionId?: string; status: KanbanCriterionStatus; blockedReason?: string | null }
  ) {
    /* Agents update checklist truth directly so the external runner can decide whether to resume or stop. */
    if (!body?.status) {
      throw new BadRequestException("status is required");
    }

    try {
      const task = await this.kanban.updateCriterionFromExecution({
        taskId,
        criterionId,
        status: this.parseCriterionStatus(body.status),
        blockedReason: body?.blockedReason,
        actor: this.resolveExecutionActor(body)
      });
      publishKanbanTaskUpdated(this.events, { task, source: "agent" });
      return task;
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("claim-next")
  public async claimNext(
    @Body()
      body: {
        agentId?: string;
        sessionId?: string;
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
      const task = await this.kanban.claimNextTask({
        agentId: body.agentId,
        projectSlug: body?.projectSlug ?? null,
        currentDirectory: body?.currentDirectory ?? null,
        executionSessionId: body?.sessionId ?? null,
        leaseMs: typeof body?.leaseMs === "number" ? body.leaseMs : undefined
      });
      if (task) {
        publishKanbanTaskUpdated(this.events, { task, source: "agent" });
      }
      return {
        task
      };
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:id/complete")
  public async completeTask(
    @Param("id") id: string,
    @Body() body: { agentId?: string; sessionId?: string; resultSummary?: string | null }
  ) {
    /* Agent completion writes back a short outcome summary for humans reviewing the board. */
    try {
      const task = await this.kanban.completeTaskFromExecution({
        taskId: id,
        resultSummary: body?.resultSummary,
        actor: this.resolveExecutionActor(body)
      });
      publishKanbanTaskUpdated(this.events, { task, source: "agent" });
      return task;
    } catch (error) {
      this.rethrowAsHttp(error);
    }
  }

  @Post("tasks/:id/block")
  public async blockTask(@Param("id") id: string, @Body() body: { agentId?: string; sessionId?: string; reason?: string | null }) {
    /* Blocking preserves the exact dependency or ambiguity the agent could not resolve alone. */
    try {
      const task = await this.kanban.blockTaskFromExecution({
        taskId: id,
        reason: body?.reason,
        actor: this.resolveExecutionActor(body)
      });
      publishKanbanTaskUpdated(this.events, { task, source: "agent" });
      return task;
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

  private parseCriterionStatus(value: string): KanbanCriterionStatus {
    /* Criterion states stay tightly bounded so agents cannot invent intermediate checklist phases. */
    if (!KANBAN_CRITERION_STATUSES.includes(value as KanbanCriterionStatus)) {
      throw new KanbanValidationError("Valid kanban criterion status is required");
    }
    return value as KanbanCriterionStatus;
  }

  private rethrowAsHttp(error: unknown): never {
    /* Tool callers receive 400 only for fixable validation problems; unexpected failures stay 500. */
    if (error instanceof KanbanValidationError) {
      throw new BadRequestException(error.message);
    }
    if (error instanceof KanbanExecutionConflictError) {
      throw new ConflictException(error.message);
    }
    throw error;
  }

  private async updateTaskForAgent(
    taskId: string,
    body: AgentTaskRefineBody
  ) {
    /* Session starts become an atomic claim before any non-status metadata edits are applied. */
    const nextStatus = body?.status ? this.parseStatus(body.status) : null;
    if (nextStatus === "in_progress") {
      const started = await this.kanban.startTaskExecution({
        taskId,
        agentId: typeof body?.agentId === "string" && body.agentId.trim().length > 0 ? body.agentId : DEFAULT_SESSION_AGENT_ID,
        executionSource: "session",
        executionSessionId: body?.sessionId ?? null
      });

      /* After claiming execution, only the remaining metadata patch should be forwarded. */
      const patch = this.buildAgentTaskPatch({ body, status: null });
      return Object.keys(patch).length > 0
        ? this.kanban.updateTaskFromExecution({
            taskId: started.id,
            patch,
            actor: this.resolveExecutionActor(body)
          })
        : started;
    }

    return this.kanban.updateTaskFromExecution({
      taskId,
      actor: this.resolveExecutionActor(body),
      patch: this.buildAgentTaskPatch({ body, status: nextStatus })
    });
  }

  private buildAgentTaskPatch(input: { body: AgentTaskRefineBody; status: KanbanStatus | null }): UpdateKanbanTaskInput {
    /* Empty arrays from LLM tools usually mean "unchanged", but an explicit clear flag must still wipe the checklist. */
    const shouldReplaceAcceptanceCriteria =
      input.body.clearAcceptanceCriteria === true ||
      (Array.isArray(input.body.acceptanceCriteria) && input.body.acceptanceCriteria.length > 0);

    return {
      ...(typeof input.body.title === "string" ? { title: input.body.title } : {}),
      ...(typeof input.body.description === "string" ? { description: input.body.description } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.body.priority ? { priority: this.parsePriority(input.body.priority) } : {}),
      ...(shouldReplaceAcceptanceCriteria ? { acceptanceCriteria: input.body.acceptanceCriteria ?? [] } : {}),
      ...(input.body.resultSummary !== undefined ? { resultSummary: input.body.resultSummary } : {}),
      ...(input.body.blockedReason !== undefined ? { blockedReason: input.body.blockedReason } : {})
    };
  }

  private resolveExecutionActor(body: { agentId?: string; sessionId?: string } | null | undefined): KanbanExecutionActor {
    /* Agent mutations must carry their OpenCode session id so backend can reject cross-session execution writes. */
    return {
      agentId: typeof body?.agentId === "string" && body.agentId.trim().length > 0 ? body.agentId : DEFAULT_SESSION_AGENT_ID,
      sessionId: typeof body?.sessionId === "string" && body.sessionId.trim().length > 0 ? body.sessionId : null,
      source: "session"
    };
  }
}
