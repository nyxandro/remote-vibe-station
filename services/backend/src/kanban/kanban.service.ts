/**
 * @fileoverview Domain service for kanban task CRUD, criterion tracking, claiming, and share links.
 *
 * Exports:
 * - KanbanService - Orchestrates project-aware board operations for UI, agents, and automation runner.
 */

import * as crypto from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import {
  decorateKanbanTasks,
  resolveOptionalKanbanProjectSlug,
  resolveRequiredKanbanProjectSlug
} from "./kanban-project-utils";
import { buildKanbanBoardUrl } from "./kanban-board-link";
import { createWebToken } from "../security/web-token";
import { ProjectsService } from "../projects/projects.service";
import { normalizeCriterionInputs } from "./kanban-criteria";
import { KanbanValidationError } from "./kanban.errors";
import {
  assertKanbanExecutionOwner,
  assertKanbanTaskCanStartExecution,
  KanbanExecutionActor
} from "./kanban-execution-ownership";
import { applyKanbanCriterionPatch, applyKanbanTaskPatch } from "./kanban-task-mutations";
import { buildInitialKanbanStatusTimeline, recordKanbanTaskStatusTransition } from "./kanban-task-timeline";
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
    const resolvedProjectSlug = resolveOptionalKanbanProjectSlug({
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
      return decorateKanbanTasks(sliced, projects);
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
      return resolveRequiredKanbanProjectSlug({
        projectSlug: input.projectSlug,
        currentDirectory: input.currentDirectory,
        projects
      });
    }

    return resolveOptionalKanbanProjectSlug({
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
        executionSessionId: null,
        blockedResumeStatus: null,
        statusTimeline: buildInitialKanbanStatusTimeline({ status, changedAt: nowIso })
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
      applyKanbanTaskPatch(task, patch);
      return task;
    });

    return this.decorateTask(updated);
  }

  public async deleteTask(taskId: string): Promise<KanbanTaskView> {
    /* Deletion physically removes obsolete cards so user-owned cleanup does not leave hidden JSON residue behind. */
    const deleted = await this.store.transact((draft) => {
      const task = this.findTaskOrThrow(draft.tasks, taskId);
      if (task.status === "in_progress") {
        throw new KanbanValidationError(`Cannot delete kanban task "${task.id}" while it is in progress. Block or finish it first.`);
      }
      draft.tasks = draft.tasks.filter((item) => item.id !== task.id);
      return task;
    });

    return this.decorateTask(deleted);
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
      applyKanbanCriterionPatch(task, draft.tasks, input);
      return task;
    });

    return this.decorateTask(updated);
  }

  public async updateTaskFromExecution(input: {
    taskId: string;
    actor: KanbanExecutionActor;
    patch: UpdateKanbanTaskInput;
  }): Promise<KanbanTaskView> {
    /* Execution-bound task edits must come only from the owning OpenCode session. */
    const task = await this.store.transact((draft) => {
      const existing = this.findTaskOrThrow(draft.tasks, input.taskId);
      assertKanbanExecutionOwner({ task: existing, actor: input.actor });
      applyKanbanTaskPatch(existing, input.patch);
      return existing;
    });

    return this.decorateTask(task);
  }

  public async updateCriterionFromExecution(input: {
    taskId: string;
    criterionId: string;
    status: KanbanCriterionStatus;
    blockedReason?: string | null;
    actor: KanbanExecutionActor;
  }): Promise<KanbanTaskView> {
    /* Checklist progress must stay owned by the same OpenCode session that executes the task. */
    const task = await this.store.transact((draft) => {
      const task = this.findTaskOrThrow(draft.tasks, input.taskId);
      assertKanbanExecutionOwner({ task, actor: input.actor });
      applyKanbanCriterionPatch(task, draft.tasks, input);
      return task;
    });

    return this.decorateTask(task);
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
    const task = await this.updateTask(input.taskId, {
      status: "done",
      resultSummary: normalizeNullableKanbanText(input.resultSummary)
    });

    /* Every finished task also snapshots the full board into host-backed backups for fast disaster recovery. */
    await this.writeTaskCompletionBackup();
    return task;
  }

  public async completeTaskFromExecution(input: {
    taskId: string;
    resultSummary?: string | null;
    actor: KanbanExecutionActor;
  }): Promise<KanbanTaskView> {
    /* Only the owning session may declare execution complete. */
    const task = await this.store.transact((draft) => {
      const task = this.findTaskOrThrow(draft.tasks, input.taskId);
      assertKanbanExecutionOwner({ task, actor: input.actor });
      applyKanbanTaskPatch(task, {
        status: "done",
        resultSummary: normalizeNullableKanbanText(input.resultSummary)
      });
      return task;
    });

    const completed = await this.decorateTask(task);

    /* Runner/session completions share the same external backup policy as manual board completion. */
    await this.writeTaskCompletionBackup();
    return completed;
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

  public async blockTaskFromExecution(input: {
    taskId: string;
    reason?: string | null;
    actor: KanbanExecutionActor;
  }): Promise<KanbanTaskView> {
    /* Only the owning session may stop execution with a blocker reason. */
    const task = await this.store.transact((draft) => {
      const task = this.findTaskOrThrow(draft.tasks, input.taskId);
      assertKanbanExecutionOwner({ task, actor: input.actor });
      applyKanbanTaskPatch(task, {
        status: "blocked",
        blockedReason: normalizeNullableKanbanText(input.reason)
      });
      return task;
    });

    return this.decorateTask(task);
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
      const actor: KanbanExecutionActor = {
        agentId,
        sessionId: input.executionSessionId ?? null,
        source: input.executionSource
      };

      /* A running owner keeps exclusive execution rights until the task finishes, blocks, or expires. */
      if (task.status === "done" || task.status === "blocked") {
        throw new KanbanValidationError(`Cannot start task "${task.id}" from status "${task.status}".`);
      }

      assertKanbanTaskCanStartExecution({ task, actor });

      const previousStatus = task.status;
      task.status = "in_progress";
      task.claimedBy = agentId;
      task.leaseUntil = leaseUntil;
      task.executionSource = input.executionSource;
      task.executionSessionId = normalizeNullableKanbanText(input.executionSessionId) ?? task.executionSessionId ?? null;
      task.updatedAt = nowIso;
      recordKanbanTaskStatusTransition({ task, previousStatus, changedAt: nowIso });
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
    const projectSlug = resolveRequiredKanbanProjectSlug({
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

      const previousStatus = next.status;
      next.status = "in_progress";
      next.claimedBy = agentId;
      next.leaseUntil = leaseUntil;
      next.executionSource = agentId === RUNNER_AGENT_ID ? "runner" : "session";
      next.executionSessionId = normalizeNullableKanbanText(input.executionSessionId);
      next.updatedAt = nowIso;
      recordKanbanTaskStatusTransition({ task: next, previousStatus, changedAt: nowIso });
      return next;
    });

    return claimed ? this.decorateTask(claimed) : null;
  }

  public async createBoardLink(input: {
    adminId: number;
    projectSlug?: string | null;
    localDevOrigin?: string | null;
    nowMs?: number;
  }): Promise<{ url: string }> {
    /* Shared board link reuses signed browser auth token instead of exposing internal agent endpoints. */
    const token = createWebToken({
      adminId: input.adminId,
      botToken: this.config.telegramBotToken,
      nowMs: input.nowMs
    });

    /* Local dev may intentionally override the public base so shared-board debugging stays on localhost. */
    return {
      url: buildKanbanBoardUrl({
        token,
        publicBaseUrl: this.config.publicBaseUrl,
        localDevOrigin: input.localDevOrigin,
        projectSlug: input.projectSlug
      })
    };
  }

  private async decorateTask(task: KanbanTaskRecord): Promise<KanbanTaskView> {
    /* Single-task responses still resolve the current human-friendly project name for UI consistency. */
    const projects = await this.projects.list();
    return decorateKanbanTasks([task], projects)[0] as KanbanTaskView;
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

  private async writeTaskCompletionBackup(): Promise<void> {
    /* Older isolated unit mocks may not implement the backup helper, but production store always does. */
    const writeBackup = (this.store as Pick<KanbanStore, "writeTaskCompletionBackup"> | Partial<KanbanStore>)
      .writeTaskCompletionBackup;
    if (typeof writeBackup !== "function") {
      return;
    }

    await writeBackup.call(this.store);
  }

}
