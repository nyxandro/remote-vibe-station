/**
 * @fileoverview Domain service for kanban task CRUD, claiming, and share links.
 *
 * Exports:
 * - KanbanService - Orchestrates project-aware board operations for UI and agent tools.
 */

import * as crypto from "node:crypto";
import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { createWebToken } from "../security/web-token";
import { ProjectsService } from "../projects/projects.service";
import { KanbanValidationError } from "./kanban.errors";
import { KanbanStore } from "./kanban.store";
import {
  KANBAN_PRIORITIES,
  KANBAN_STATUSES,
  CreateKanbanTaskInput,
  KanbanPriority,
  KanbanStatus,
  KanbanTaskRecord,
  KanbanTaskView,
  UpdateKanbanTaskInput
} from "./kanban.types";

const DEFAULT_CLAIM_LEASE_MS = 2 * 60 * 60 * 1000;

const PRIORITY_WEIGHT: Record<KanbanPriority, number> = {
  low: 1,
  medium: 2,
  high: 3
};

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
    const status = this.normalizeOptionalStatus(input?.status ?? null);
    const limit = this.normalizeOptionalLimit(input?.limit);

    return this.store.transact((draft) => {
      this.releaseExpiredLeases(draft.tasks, nowMs);

      const filtered = draft.tasks
        .filter((task) => (resolvedProjectSlug ? task.projectSlug === resolvedProjectSlug : true))
        .filter((task) => (status ? task.status === status : true))
        .sort((left, right) => this.compareTasks(left, right));

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
    const projectSlug = this.requireProjectSlug(input.projectSlug);
    await this.requireExistingProject(projectSlug);

    const title = this.requireTitle(input.title);
    const description = this.normalizeText(input.description);
    const status = this.requireStatus(input.status);
    const priority = this.requirePriority(input.priority);
    const acceptanceCriteria = this.normalizeCriteria(input.acceptanceCriteria);
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
        leaseUntil: null
      };

      draft.tasks.push(task);
      return task;
    });

    return this.decorateTask(created);
  }

  public async updateTask(taskId: string, patch: UpdateKanbanTaskInput): Promise<KanbanTaskView> {
    /* Backlog refinement and manual edits both flow through the same explicit patch surface. */
    const normalizedPatch = this.normalizeUpdatePatch(patch);

    const updated = await this.store.transact((draft) => {
      const task = this.findTaskOrThrow(draft.tasks, taskId);
      const nextStatus = normalizedPatch.status ?? task.status;

      if (typeof normalizedPatch.title === "string") {
        task.title = normalizedPatch.title;
      }
      if (typeof normalizedPatch.description === "string") {
        task.description = normalizedPatch.description;
      }
      if (typeof normalizedPatch.priority === "string") {
        task.priority = normalizedPatch.priority;
      }
      if (Array.isArray(normalizedPatch.acceptanceCriteria)) {
        task.acceptanceCriteria = normalizedPatch.acceptanceCriteria;
      }

      task.status = nextStatus;

      /* Clear agent lease whenever humans move a card out of active execution. */
      if (nextStatus !== "in_progress") {
        task.claimedBy = null;
        task.leaseUntil = null;
      }

      /* Keep status-specific notes explicit so stale blocker/result text does not leak into other phases. */
      task.resultSummary = nextStatus === "done" ? normalizedPatch.resultSummary ?? null : null;
      task.blockedReason = nextStatus === "blocked" ? normalizedPatch.blockedReason ?? null : null;
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
      resultSummary: this.normalizeNullableText(input.resultSummary)
    });
  }

  public async blockTask(input: {
    taskId: string;
    reason?: string | null;
  }): Promise<KanbanTaskView> {
    /* Blocked cards must carry an explicit reason so humans know what to unblock. */
    return this.updateTask(input.taskId, {
      status: "blocked",
      blockedReason: this.normalizeNullableText(input.reason)
    });
  }

  public async claimNextTask(input: {
    agentId: string;
    projectSlug?: string | null;
    currentDirectory?: string | null;
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
    const agentId = this.requireAgentId(input.agentId);
    const leaseMs = this.normalizeLeaseMs(input.leaseMs);
    const nowMs = input.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const leaseUntil = new Date(nowMs + leaseMs).toISOString();

    const claimed = await this.store.transact((draft) => {
      this.releaseExpiredLeases(draft.tasks, nowMs);

      const next = draft.tasks
        .filter((task) => task.projectSlug === projectSlug && task.status === "queued")
        .sort((left, right) => this.compareTasks(left, right))[0] ?? null;

      if (!next) {
        return null;
      }

      next.status = "in_progress";
      next.claimedBy = agentId;
      next.leaseUntil = leaseUntil;
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

    const url = new URL("/miniapp", this.config.publicBaseUrl);
    url.searchParams.set("view", "kanban");
    if (input.projectSlug) {
      url.searchParams.set("project", this.requireProjectSlug(input.projectSlug));
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

  private compareTasks(left: KanbanTaskRecord, right: KanbanTaskRecord): number {
    /* Keep visual board order identical to claim order so humans understand what the agent will pick next. */
    const priorityDelta = PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const updatedDelta = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    const createdDelta = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (createdDelta !== 0) {
      return createdDelta;
    }

    return left.title.localeCompare(right.title);
  }

  private releaseExpiredLeases(tasks: KanbanTaskRecord[], nowMs: number): void {
    /* Expired in-progress cards are returned to queued so another agent can continue the work. */
    for (const task of tasks) {
      if (task.status !== "in_progress" || !task.leaseUntil) {
        continue;
      }

      const leaseUntilMs = Date.parse(task.leaseUntil);
      if (!Number.isFinite(leaseUntilMs) || leaseUntilMs > nowMs) {
        continue;
      }

      task.status = "queued";
      task.claimedBy = null;
      task.leaseUntil = null;
      task.updatedAt = new Date(nowMs).toISOString();
    }
  }

  private async resolveOptionalProjectSlug(input: {
    projectSlug?: string | null;
    currentDirectory?: string | null;
    projects?: Array<{ slug: string; rootPath: string }>;
  }): Promise<string | null> {
    /* Agent tools may omit project slug when OpenCode already knows the current working directory. */
    if (input.projectSlug && input.projectSlug.trim().length > 0) {
      return this.requireProjectSlug(input.projectSlug);
    }

    const currentDirectory = input.currentDirectory?.trim();
    if (!currentDirectory) {
      return null;
    }

    const projects = input.projects ?? (await this.projects.list());
    const resolvedDirectory = path.resolve(currentDirectory);
    const matching = projects
      .map((project) => ({ project, rootPath: path.resolve(project.rootPath) }))
      .filter(({ rootPath }) => {
        return resolvedDirectory === rootPath || resolvedDirectory.startsWith(`${rootPath}${path.sep}`);
      })
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

  private requireTitle(value: string): string {
    /* Titles are mandatory because both UI cards and agent tools rely on concise task names. */
    const normalized = this.normalizeText(value);
    if (!normalized) {
      throw new KanbanValidationError("Task title is required");
    }
    return normalized;
  }

  private requireProjectSlug(value: string): string {
    /* Project slug must stay explicit because every board card belongs to a real project. */
    const normalized = this.normalizeText(value);
    if (!normalized) {
      throw new KanbanValidationError("Project slug is required");
    }
    return normalized;
  }

  private requireAgentId(value: string): string {
    /* Agent identity remains explicit in task history and helps explain current ownership in the board. */
    const normalized = this.normalizeText(value);
    if (!normalized) {
      throw new KanbanValidationError("Agent id is required");
    }
    return normalized;
  }

  private normalizeCriteria(criteria: string[] | undefined): string[] {
    /* Acceptance criteria use trimmed non-empty lines so discussion output stays predictable in UI and tools. */
    if (!Array.isArray(criteria)) {
      return [];
    }

    return criteria
      .map((item) => this.normalizeText(item))
      .filter((item) => item.length > 0);
  }

  private normalizeUpdatePatch(patch: UpdateKanbanTaskInput): UpdateKanbanTaskInput {
    /* Patch normalization keeps controller validation minimal while preserving fail-fast semantics here. */
    return {
      ...(typeof patch.title === "string" ? { title: this.requireTitle(patch.title) } : {}),
      ...(typeof patch.description === "string"
        ? { description: this.normalizeText(patch.description) }
        : {}),
      ...(typeof patch.status === "string" ? { status: this.requireStatus(patch.status) } : {}),
      ...(typeof patch.priority === "string"
        ? { priority: this.requirePriority(patch.priority) }
        : {}),
      ...(Array.isArray(patch.acceptanceCriteria)
        ? { acceptanceCriteria: this.normalizeCriteria(patch.acceptanceCriteria) }
        : {}),
      ...(patch.resultSummary !== undefined
        ? { resultSummary: this.normalizeNullableText(patch.resultSummary) }
        : {}),
      ...(patch.blockedReason !== undefined
        ? { blockedReason: this.normalizeNullableText(patch.blockedReason) }
        : {})
    };
  }

  private requireStatus(value: KanbanStatus): KanbanStatus {
    /* Reject unknown states early so drag-and-drop/API bugs never silently corrupt stored tasks. */
    if (!KANBAN_STATUSES.includes(value)) {
      throw new KanbanValidationError(`Unsupported kanban status: ${value}`);
    }
    return value;
  }

  private normalizeOptionalStatus(value: KanbanStatus | null): KanbanStatus | null {
    /* Optional filters keep null semantics explicit for list endpoints. */
    if (!value) {
      return null;
    }
    return this.requireStatus(value);
  }

  private requirePriority(value: KanbanPriority): KanbanPriority {
    /* Priority drives both board ordering and agent queue selection, so values are strictly bounded. */
    if (!KANBAN_PRIORITIES.includes(value)) {
      throw new KanbanValidationError(`Unsupported kanban priority: ${value}`);
    }
    return value;
  }

  private normalizeOptionalLimit(value: number | undefined): number | null {
    /* Tool list endpoints optionally cap output size to keep agent context concise. */
    if (value == null) {
      return null;
    }
    if (!Number.isFinite(value) || value < 1) {
      throw new KanbanValidationError("limit must be a positive number");
    }
    return Math.floor(value);
  }

  private normalizeLeaseMs(value: number | undefined): number {
    /* Explicit bounded lease avoids indefinite agent ownership while keeping long tasks practical. */
    if (value == null) {
      return DEFAULT_CLAIM_LEASE_MS;
    }
    if (!Number.isFinite(value) || value < 60_000) {
      throw new KanbanValidationError("leaseMs must be at least 60000");
    }
    return Math.floor(value);
  }

  private normalizeText(value: string | null | undefined): string {
    /* Shared text normalization keeps all persisted task fields trimmed and consistent. */
    return typeof value === "string" ? value.trim() : "";
  }

  private normalizeNullableText(value: string | null | undefined): string | null {
    /* Nullable summaries/reasons intentionally preserve absence instead of empty-string noise. */
    const normalized = this.normalizeText(value);
    return normalized.length > 0 ? normalized : null;
  }
}
