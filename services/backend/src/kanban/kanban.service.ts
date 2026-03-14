/**
 * @fileoverview Domain service for kanban task CRUD, criterion tracking, claiming, and share links.
 *
 * Exports:
 * - KanbanService - Orchestrates project-aware board operations for UI, agents, and automation runner.
 */

import * as crypto from "node:crypto";
import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { createWebToken } from "../security/web-token";
import { ProjectsService } from "../projects/projects.service";
import { normalizeCriterionInputs } from "./kanban-criteria";
import { KanbanValidationError } from "./kanban.errors";
import { KanbanStore } from "./kanban.store";
import {
  compareKanbanTasks,
  releaseExpiredKanbanLeases,
  resolveKanbanTaskStatus
} from "./kanban-task-state";
import {
  CreateKanbanTaskInput,
  KanbanCriterionStatus,
  KanbanExecutionSource,
  KanbanStatus,
  KanbanTaskRecord,
  KanbanTaskView,
  UpdateKanbanTaskInput
} from "./kanban.types";
import {
  normalizeKanbanLeaseMs,
  normalizeKanbanText,
  normalizeNullableKanbanText,
  normalizeOptionalKanbanLimit,
  normalizeOptionalKanbanStatus,
  requireKanbanAgentId,
  requireKanbanCriterionId,
  requireKanbanCriterionStatus,
  requireKanbanPriority,
  requireKanbanProjectSlug,
  requireKanbanStatus,
  requireKanbanTaskId,
  requireKanbanTitle
} from "./kanban-value-guards";

const RUNNER_AGENT_ID = "kanban-runner";

@Injectable()
export class KanbanService {
  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly projects: ProjectsService,
    private readonly store: KanbanStore
  ) {}

  public async listTasks(input?: {
    projectSlug?: string | null;
    currentDirectory?: string | null;
    status?: KanbanStatus | null;
    limit?: number;
    nowMs?: number;
  }): Promise<KanbanTaskView[]> {
    /* Every read pass also normalizes expired leases so dead agents release work automatically. */
    const nowMs = input?.nowMs ?? Date.now();
    const projects = await this.projects.list();
    const resolvedProjectSlug = await this.resolveOptionalProjectSlug({
      projectSlug: input?.projectSlug,
      currentDirectory: input?.currentDirectory,
      projects
    });
    const status = normalizeOptionalKanbanStatus(input?.status ?? null);
    const limit = normalizeOptionalKanbanLimit(input?.limit);

    return this.store.transact((draft) => {
      releaseExpiredKanbanLeases(draft.tasks, nowMs);

      const filtered = draft.tasks
        .filter((task) => (resolvedProjectSlug ? task.projectSlug === resolvedProjectSlug : true))
        .filter((task) => (status ? task.status === status : true))
        .sort(compareKanbanTasks);

      const sliced = typeof limit === "number" ? filtered.slice(0, limit) : filtered;
      return this.decorateTasks(sliced, projects);
    });
  }

  public async resolveProjectSlug(input: {
    projectSlug?: string | null;
    currentDirectory?: string | null;
    required?: boolean;
  }): Promise<string | null> {
    /* External callers reuse the same directory->project resolution logic as queue claiming. */
    const projects = await this.projects.list();
    if (input.required) {
      return this.resolveRequiredProjectSlug({
        projectSlug: input.projectSlug,
        currentDirectory: input.currentDirectory,
        projects
      });
    }

    return this.resolveOptionalProjectSlug({
      projectSlug: input.projectSlug,
      currentDirectory: input.currentDirectory,
      projects
    });
  }

  public async createTask(input: CreateKanbanTaskInput): Promise<KanbanTaskView> {
    /* New tasks always validate the target project explicitly to avoid orphaned cards. */
    const projectSlug = requireKanbanProjectSlug(input.projectSlug);
    this.requireExistingProject(projectSlug);

    const title = requireKanbanTitle(input.title);
    const description = normalizeKanbanText(input.description);
    const priority = requireKanbanPriority(input.priority);
    const acceptanceCriteria = normalizeCriterionInputs(input.acceptanceCriteria, {
      createId: () => crypto.randomUUID()
    });
    const status = resolveKanbanTaskStatus({
       requestedStatus: requireKanbanStatus(input.status),
        acceptanceCriteria
      });
    const nowIso = new Date().toISOString();

    const created = await this.store.transact((draft) => {
      const task: KanbanTaskRecord = {
        id: crypto.randomUUID(),
        projectSlug,
        title,
        description,
        status,
        priority,
        acceptanceCriteria,
        resultSummary: null,
        blockedReason: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        claimedBy: null,
        leaseUntil: null,
        executionSource: null,
        executionSessionId: null
      };

      draft.tasks.push(task);
      return task;
    });

    return this.decorateTask(created);
  }

  public async updateTask(taskId: string, patch: UpdateKanbanTaskInput): Promise<KanbanTaskView> {
    /* Backlog refinement and manual edits both flow through the same explicit patch surface. */
    const updated = await this.store.transact((draft) => {
      const task = this.findTaskOrThrow(draft.tasks, taskId);
      const nextCriteria = Array.isArray(patch.acceptanceCriteria)
        ? normalizeCriterionInputs(patch.acceptanceCriteria, {
            existingCriteria: task.acceptanceCriteria,
            createId: () => crypto.randomUUID()
          })
        : task.acceptanceCriteria;
      const nextStatus = resolveKanbanTaskStatus({
        requestedStatus: patch.status ? requireKanbanStatus(patch.status) : task.status,
        acceptanceCriteria: nextCriteria
      });

      if (typeof patch.title === "string") {
        task.title = requireKanbanTitle(patch.title);
      }
      if (typeof patch.description === "string") {
        task.description = normalizeKanbanText(patch.description);
      }
      if (typeof patch.priority === "string") {
        task.priority = requireKanbanPriority(patch.priority);
      }

      task.acceptanceCriteria = nextCriteria;
      task.status = nextStatus;

      /* Clear agent lease whenever humans move a card out of active execution. */
      if (nextStatus !== "in_progress") {
        task.claimedBy = null;
        task.leaseUntil = null;
        task.executionSource = null;
        task.executionSessionId = null;
      }

      /* Keep status-specific notes explicit so stale blocker/result text does not leak into other phases. */
      task.resultSummary =
        nextStatus === "done"
          ? patch.resultSummary !== undefined
            ? normalizeNullableKanbanText(patch.resultSummary)
            : task.resultSummary
          : null;
      task.blockedReason =
        nextStatus === "blocked"
          ? patch.blockedReason !== undefined
            ? normalizeNullableKanbanText(patch.blockedReason)
            : task.blockedReason
          : null;
      task.updatedAt = new Date().toISOString();
      return task;
    });

    return this.decorateTask(updated);
  }

  public async updateCriterion(input: {
    taskId: string;
    criterionId: string;
    status: KanbanCriterionStatus;
    blockedReason?: string | null;
  }): Promise<KanbanTaskView> {
    /* Criterion updates drive resumable automation, so they are first-class mutations instead of free-form notes. */
    const updated = await this.store.transact((draft) => {
      const task = this.findTaskOrThrow(draft.tasks, input.taskId);
      const criterion = task.acceptanceCriteria.find((item) => item.id === requireKanbanCriterionId(input.criterionId));
      if (!criterion) {
        throw new KanbanValidationError(`Kanban criterion not found: ${input.criterionId}`);
      }

      const nextStatus = requireKanbanCriterionStatus(input.status);
      if (task.status === "done" && nextStatus !== "done") {
        throw new KanbanValidationError("Done tasks must be reopened before changing criterion status");
      }

      criterion.status = nextStatus;
      criterion.blockedReason = nextStatus === "blocked" ? normalizeNullableKanbanText(input.blockedReason) : null;

      if (nextStatus === "blocked") {
        task.status = "blocked";
        task.blockedReason = normalizeNullableKanbanText(input.blockedReason) ?? task.blockedReason;
        task.claimedBy = null;
        task.leaseUntil = null;
        task.executionSource = null;
        task.executionSessionId = null;
      }

      task.updatedAt = new Date().toISOString();
      return task;
    });

    return this.decorateTask(updated);
  }

  public async moveTask(taskId: string, status: KanbanStatus): Promise<KanbanTaskView> {
    /* Drag-and-drop only changes workflow state; other fields remain untouched. */
    return this.updateTask(taskId, { status });
  }

  public async completeTask(input: {
    taskId: string;
    resultSummary?: string | null;
  }): Promise<KanbanTaskView> {
    /* Completion persists a concise result summary for later review in the board. */
    return this.updateTask(input.taskId, {
      status: "done",
      resultSummary: normalizeNullableKanbanText(input.resultSummary)
    });
  }

  public async blockTask(input: {
    taskId: string;
    reason?: string | null;
  }): Promise<KanbanTaskView> {
    /* Blocked cards must carry an explicit reason so humans know what to unblock. */
    return this.updateTask(input.taskId, {
      status: "blocked",
      blockedReason: normalizeNullableKanbanText(input.reason)
    });
  }

  public async startTaskExecution(input: {
    taskId: string;
    agentId: string;
    executionSource: KanbanExecutionSource;
    executionSessionId?: string | null;
    leaseMs?: number;
    nowMs?: number;
  }): Promise<KanbanTaskView> {
    /* Starting execution is atomic so session-start and runner-start cannot both win the same task. */
    const taskId = requireKanbanTaskId(input.taskId);
    const agentId = requireKanbanAgentId(input.agentId);
    const leaseMs = normalizeKanbanLeaseMs(input.leaseMs);
    const nowMs = input.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const leaseUntil = new Date(nowMs + leaseMs).toISOString();

    const started = await this.store.transact((draft) => {
      releaseExpiredKanbanLeases(draft.tasks, nowMs);
      const task = this.findTaskOrThrow(draft.tasks, taskId);

      /* A running owner keeps exclusive execution rights until the task finishes, blocks, or expires. */
      if (task.status === "in_progress" && task.executionSource && task.executionSource !== input.executionSource) {
        throw new KanbanValidationError(
          `Cannot start task "${task.id}" because it is already owned by execution source "${task.executionSource}".`
        );
      }
      if (task.status === "done" || task.status === "blocked") {
        throw new KanbanValidationError(`Cannot start task "${task.id}" from status "${task.status}".`);
      }

      task.status = "in_progress";
      task.claimedBy = agentId;
      task.leaseUntil = leaseUntil;
      task.executionSource = input.executionSource;
      task.executionSessionId = normalizeNullableKanbanText(input.executionSessionId) ?? task.executionSessionId ?? null;
      task.updatedAt = nowIso;
      return task;
    });

    return this.decorateTask(started);
  }

  public async claimNextTask(input: {
    agentId: string;
    projectSlug?: string | null;
    currentDirectory?: string | null;
    executionSessionId?: string | null;
    leaseMs?: number;
    nowMs?: number;
  }): Promise<KanbanTaskView | null> {
    /* Agent claiming is project-scoped so one worker does not silently jump into another repo. */
    const projects = await this.projects.list();
    const projectSlug = await this.resolveRequiredProjectSlug({
      projectSlug: input.projectSlug,
      currentDirectory: input.currentDirectory,
      projects
    });
    const agentId = requireKanbanAgentId(input.agentId);
    const leaseMs = normalizeKanbanLeaseMs(input.leaseMs);
    const nowMs = input.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const leaseUntil = new Date(nowMs + leaseMs).toISOString();

    const claimed = await this.store.transact((draft) => {
      releaseExpiredKanbanLeases(draft.tasks, nowMs);

      /* Refuse a second claim while the same agent still owns active work in the current project. */
      const activeTask = draft.tasks.find(
        (task) => task.projectSlug === projectSlug && task.status === "in_progress" && task.claimedBy === agentId
      );
      if (activeTask) {
        throw new KanbanValidationError(
          `Cannot claim the next queued task in project "${projectSlug}" because agent "${agentId}" already has active task "${activeTask.id}" in progress. Complete or block that task before claiming another one.`
        );
      }

      const next = draft.tasks
        .filter((task) => task.projectSlug === projectSlug && task.status === "queued")
        .sort(compareKanbanTasks)[0] ?? null;
      if (!next) {
        return null;
      }

      next.status = "in_progress";
      next.claimedBy = agentId;
      next.leaseUntil = leaseUntil;
      next.executionSource = agentId === RUNNER_AGENT_ID ? "runner" : "session";
      next.executionSessionId = next.executionSource === "session" ? normalizeNullableKanbanText(input.executionSessionId) : null;
      next.updatedAt = nowIso;
      return next;
    });

    return claimed ? this.decorateTask(claimed) : null;
  }

  public async createBoardLink(input: {
    adminId: number;
    projectSlug?: string | null;
    nowMs?: number;
  }): Promise<{ url: string }> {
    /* Shared board link reuses signed browser auth token instead of exposing internal agent endpoints. */
    const token = createWebToken({
      adminId: input.adminId,
      botToken: this.config.telegramBotToken,
      nowMs: input.nowMs
    });

    /* Use the canonical trailing-slash Mini App URL so nginx/traefik do not strip board query params on redirect. */
    const url = new URL("/miniapp/", this.config.publicBaseUrl);
      url.searchParams.set("view", "kanban");
    if (input.projectSlug) {
      url.searchParams.set("project", requireKanbanProjectSlug(input.projectSlug));
    }
    return { url: `${url.toString()}#token=${token}` };
  }

  private async decorateTask(task: KanbanTaskRecord): Promise<KanbanTaskView> {
    /* Single-task responses still resolve the current human-friendly project name for UI consistency. */
    const projects = await this.projects.list();
    return this.decorateTasks([task], projects)[0] as KanbanTaskView;
  }

  private decorateTasks(
    tasks: KanbanTaskRecord[],
    projects: Array<{ slug: string; name: string }>
  ): KanbanTaskView[] {
    /* Resolve display names without making task persistence depend on project rename history. */
    const projectNames = new Map(projects.map((project) => [project.slug, project.name]));
    return tasks.map((task) => ({
      ...task,
      projectName: projectNames.get(task.projectSlug) ?? task.projectSlug
    }));
  }

  private async resolveOptionalProjectSlug(input: {
    projectSlug?: string | null;
    currentDirectory?: string | null;
    projects?: Array<{ slug: string; rootPath: string }>;
  }): Promise<string | null> {
    /* Agent tools may omit project slug when OpenCode already knows the current working directory. */
    if (input.projectSlug && input.projectSlug.trim().length > 0) {
      return requireKanbanProjectSlug(input.projectSlug);
    }

    const currentDirectory = input.currentDirectory?.trim();
    if (!currentDirectory) {
      return null;
    }

    const projects = input.projects ?? (await this.projects.list());
    const resolvedDirectory = path.resolve(currentDirectory);
    const matching = projects
      .map((project) => ({ project, rootPath: path.resolve(project.rootPath) }))
      .filter(({ rootPath }) => resolvedDirectory === rootPath || resolvedDirectory.startsWith(`${rootPath}${path.sep}`))
      .sort((left, right) => right.rootPath.length - left.rootPath.length)[0];

    return matching?.project.slug ?? null;
  }

  private async resolveRequiredProjectSlug(input: {
    projectSlug?: string | null;
    currentDirectory?: string | null;
    projects?: Array<{ slug: string; rootPath: string }>;
  }): Promise<string> {
    /* Claiming/creation must fail fast when project scope cannot be inferred safely. */
    const resolved = await this.resolveOptionalProjectSlug(input);
    if (!resolved) {
      throw new KanbanValidationError("Project slug is required for this operation");
    }
    return resolved;
  }

  private requireExistingProject(projectSlug: string): void {
    /* Reuse project discovery as the canonical source of truth for valid project ids. */
    try {
      this.projects.getProjectRootPath(projectSlug);
    } catch (error) {
      throw new KanbanValidationError(error instanceof Error ? error.message : "Unknown project");
    }
  }

  private findTaskOrThrow(tasks: KanbanTaskRecord[], taskId: string): KanbanTaskRecord {
    /* Keep mutations explicit and fail loudly when a referenced card no longer exists. */
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new KanbanValidationError(`Kanban task not found: ${taskId}`);
    }
    return task;
  }

}
