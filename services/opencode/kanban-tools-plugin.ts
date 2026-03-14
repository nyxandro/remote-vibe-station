/**
 * @fileoverview OpenCode local plugin that exposes kanban task tools backed by the backend API.
 *
 * Exports:
 * - KanbanToolsPlugin - Registers task listing, refinement, criterion updates, claiming, and completion tools.
 */

import { type Plugin, tool } from "@opencode-ai/plugin";

const STATUS_OPTIONS = ["backlog", "queued", "in_progress", "blocked", "done"] as const;
const PRIORITY_OPTIONS = ["low", "medium", "high"] as const;
const CRITERION_STATUS_OPTIONS = ["pending", "done", "blocked"] as const;
const DEFAULT_AGENT_ID = "opencode-agent";
const DEFAULT_LIMIT = 20;
const DEFAULT_LEASE_MS = 2 * 60 * 60 * 1000;

type KanbanCriterion = {
  id: string;
  text: string;
  status: (typeof CRITERION_STATUS_OPTIONS)[number];
};

type KanbanTask = {
  id: string;
  projectSlug: string;
  projectName: string;
  title: string;
  description: string;
  status: (typeof STATUS_OPTIONS)[number];
  priority: (typeof PRIORITY_OPTIONS)[number];
  acceptanceCriteria: KanbanCriterion[];
  resultSummary: string | null;
  blockedReason: string | null;
  updatedAt: string;
  claimedBy: string | null;
  executionSource?: "session" | "runner" | null;
  executionSessionId?: string | null;
};

const requireRuntimeConfig = () => {
  /* Fail fast when the plugin is mounted without the internal backend connectivity env vars. */
  const baseUrl = process.env.BACKEND_URL?.trim();
  const token = process.env.BOT_BACKEND_AUTH_TOKEN?.trim();
  if (!baseUrl) {
    throw new Error("BACKEND_URL is required for kanban tools");
  }
  if (!token) {
    throw new Error("BOT_BACKEND_AUTH_TOKEN is required for kanban tools");
  }
  return { baseUrl, token };
};

const extractErrorMessage = (text: string): string => {
  /* Prefer backend validation text so agent-facing tool failures stay actionable instead of raw JSON blobs. */
  if (text.trim().length === 0) {
    return "Request failed with an empty backend error response.";
  }

  try {
    const payload = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(payload.message) && payload.message.length > 0) {
      return payload.message.join("; ");
    }
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message;
    }
  } catch {
    /* Non-JSON backend responses still fall back to their raw text so operators can inspect proxy or runtime failures. */
  }

  return text;
};

const postJson = async <T>(path: string, body: unknown): Promise<T | null> => {
  /* Every tool call goes through the same authenticated backend helper for consistency. */
  const { baseUrl, token } = requireRuntimeConfig();
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bot-backend-token": token
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const message = extractErrorMessage(await response.text());
    throw new Error(`Kanban backend request failed with status ${response.status}: ${message}`);
  }

  const text = await response.text();
  return text.trim().length > 0 ? (JSON.parse(text) as T) : null;
};

const humanizeStatus = (status: KanbanTask["status"]): string => {
  /* Keep tool output conversational so users see workflow states without backend-style snake_case labels. */
  switch (status) {
    case "backlog":
      return "Backlog";
    case "queued":
      return "Queued";
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
  }
};

const humanizePriority = (priority: KanbanTask["priority"]): string => {
  /* Match the board labels so task summaries read the same way in UI and tools. */
  switch (priority) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
  }
};

const humanizeCriterionStatus = (status: KanbanCriterion["status"]): string => {
  /* Criterion states stay binary enough for automation, but still need readable labels in tool output. */
  switch (status) {
    case "pending":
      return "Pending";
    case "done":
      return "Done";
    case "blocked":
      return "Blocked";
  }
};

const countDoneCriteria = (task: KanbanTask): number => {
  /* Shared count keeps list output aligned with detailed task views. */
  return task.acceptanceCriteria.filter((criterion) => criterion.status === "done").length;
};

const formatCriterionLine = (criterion: KanbanCriterion): string => {
  /* Stable criterion ids are required because the runner resumes tasks in fresh sessions. */
  return `  - ${criterion.id} | ${humanizeCriterionStatus(criterion.status)} | ${criterion.text}`;
};

const formatTaskLine = (task: KanbanTask): string => {
  /* Surface the stable task id explicitly so later refine/complete calls can reuse the exact same identifier. */
  const lines = [
    `- ${task.title}`,
    `  Task ID: ${task.id}`,
    `  Status: ${humanizeStatus(task.status)} | Priority: ${humanizePriority(task.priority)} | Project: ${task.projectName}`
  ];

  if (task.acceptanceCriteria.length > 0) {
    lines.push(`  Criteria: ${countDoneCriteria(task)}/${task.acceptanceCriteria.length} done`);
  }
  if (task.description) {
    lines.push(`  Description: ${task.description}`);
  }

  return lines.join("\n");
};

const formatTaskDetails = (task: KanbanTask | null): string => {
  /* Detailed card view gives the agent enough context for refinement and implementation decisions. */
  if (!task) {
    return "No matching task.";
  }

  const lines = [
    `${task.title}`,
    `taskId: ${task.id}`,
    `project: ${task.projectName} (${task.projectSlug})`,
    `status: ${humanizeStatus(task.status)}`,
    `priority: ${humanizePriority(task.priority)}`
  ];

  if (task.description) {
    lines.push(`description: ${task.description}`);
  }
  if (task.acceptanceCriteria.length > 0) {
    lines.push("acceptance criteria:");
    lines.push(...task.acceptanceCriteria.map(formatCriterionLine));
  }
  if (task.claimedBy) {
    lines.push(`claimedBy: ${task.claimedBy}`);
  }
  if (task.blockedReason) {
    lines.push(`blocked: ${task.blockedReason}`);
  }
  if (task.resultSummary) {
    lines.push(`result: ${task.resultSummary}`);
  }

  return lines.join("\n");
};

const formatTaskList = (tasks: KanbanTask[]): string => {
  /* List view starts with a short count summary and then one line per card. */
  if (tasks.length === 0) {
    return "No tasks found for the requested filter.";
  }

  return [`Tasks: ${tasks.length}`, ...tasks.map(formatTaskLine)].join("\n");
};

export const KanbanToolsPlugin: Plugin = async () => {
  return {
    tool: {
      kanban_list_tasks: tool({
        description: "List kanban tasks and their criterion states for the current project or all projects.",
        args: {
          projectSlug: tool.schema.string().optional(),
          status: tool.schema.enum(STATUS_OPTIONS).optional(),
          limit: tool.schema.number().int().positive().max(100).optional()
        },
        async execute(args, context) {
          const response = await postJson<{ tasks: KanbanTask[] }>("/api/kanban/agent/list", {
            projectSlug: args.projectSlug,
            status: args.status,
            limit: args.limit ?? DEFAULT_LIMIT,
            currentDirectory: context.directory
          });
          return formatTaskList(response?.tasks ?? []);
        }
      }),

      kanban_create_task: tool({
        description: "Create a new kanban task with explicit acceptance criteria; new criteria start as pending.",
        args: {
          projectSlug: tool.schema.string().optional(),
          title: tool.schema.string(),
          description: tool.schema.string().optional(),
          status: tool.schema.enum(STATUS_OPTIONS).optional(),
          priority: tool.schema.enum(PRIORITY_OPTIONS).optional(),
          acceptanceCriteria: tool.schema.array(tool.schema.string()).optional()
        },
        async execute(args, context) {
          const task = await postJson<KanbanTask>("/api/kanban/agent/create", {
            projectSlug: args.projectSlug,
            currentDirectory: context.directory,
            title: args.title,
            description: args.description ?? "",
            status: args.status ?? "backlog",
            priority: args.priority ?? "medium",
            acceptanceCriteria: args.acceptanceCriteria ?? []
          });
          if (!task) {
            throw new Error("Kanban backend returned an empty response for task creation");
          }
          return `Created task.\n${formatTaskDetails(task)}`;
        }
      }),

      kanban_refine_task: tool({
        description:
          "Refine an existing task: tighten scope, update text, and keep acceptance criteria accurate before or during execution.",
        args: {
          agentId: tool.schema.string().optional(),
          taskId: tool.schema.string(),
          title: tool.schema.string().optional(),
          description: tool.schema.string().optional(),
          status: tool.schema.enum(STATUS_OPTIONS).optional(),
          priority: tool.schema.enum(PRIORITY_OPTIONS).optional(),
          acceptanceCriteria: tool.schema.array(tool.schema.string()).optional(),
          resultSummary: tool.schema.string().optional(),
          blockedReason: tool.schema.string().optional()
        },
        async execute(args) {
          const task = await postJson<KanbanTask>(`/api/kanban/agent/tasks/${encodeURIComponent(args.taskId)}/refine`, {
            ...args,
            agentId: args.agentId ?? DEFAULT_AGENT_ID
          });
          if (!task) {
            throw new Error("Kanban backend returned an empty response for task refinement");
          }
          return `Updated task.\n${formatTaskDetails(task)}`;
        }
      }),

      kanban_update_criterion: tool({
        description:
          "Update one acceptance criterion while working. Mark done only after verification; mark blocked only when external help is required.",
        args: {
          taskId: tool.schema.string(),
          criterionId: tool.schema.string(),
          status: tool.schema.enum(CRITERION_STATUS_OPTIONS),
          blockedReason: tool.schema.string().optional()
        },
        async execute(args) {
          const task = await postJson<KanbanTask>(
            `/api/kanban/agent/tasks/${encodeURIComponent(args.taskId)}/criteria/${encodeURIComponent(args.criterionId)}/update`,
            {
              status: args.status,
              blockedReason: args.blockedReason ?? null
            }
          );
          if (!task) {
            throw new Error("Kanban backend returned an empty response for criterion update");
          }
          return `Updated criterion.\n${formatTaskDetails(task)}`;
        }
      }),

      kanban_claim_next: tool({
        description:
          "Claim the next queued task for the current project. Use this only when you do not already have an active task in that project.",
        args: {
          projectSlug: tool.schema.string().optional(),
          agentId: tool.schema.string().optional(),
          leaseMs: tool.schema.number().int().positive().optional()
        },
        async execute(args, context) {
          const response = await postJson<{ task: KanbanTask | null }>("/api/kanban/agent/claim-next", {
            projectSlug: args.projectSlug,
            currentDirectory: context.directory,
            agentId: args.agentId ?? DEFAULT_AGENT_ID,
            leaseMs: args.leaseMs ?? DEFAULT_LEASE_MS
          });
          if (!response?.task) {
            return "No queued task available to claim.";
          }
          return `Claimed task.\n${formatTaskDetails(response.task)}`;
        }
      }),

      kanban_complete_task: tool({
        description:
          "Mark a task done only after every acceptance criterion is done. Include a short result summary for the next human reviewer.",
        args: {
          taskId: tool.schema.string(),
          resultSummary: tool.schema.string().optional()
        },
        async execute(args) {
          const task = await postJson<KanbanTask>(`/api/kanban/agent/tasks/${encodeURIComponent(args.taskId)}/complete`, {
            resultSummary: args.resultSummary ?? null
          });
          if (!task) {
            throw new Error("Kanban backend returned an empty response for task completion");
          }
          return `Completed task.\n${formatTaskDetails(task)}`;
        }
      }),

      kanban_block_task: tool({
        description:
          "Mark a task blocked when you cannot continue. Blocking ends the current automation loop for that task until humans intervene.",
        args: {
          taskId: tool.schema.string(),
          reason: tool.schema.string().optional()
        },
        async execute(args) {
          const task = await postJson<KanbanTask>(`/api/kanban/agent/tasks/${encodeURIComponent(args.taskId)}/block`, {
            reason: args.reason ?? null
          });
          if (!task) {
            throw new Error("Kanban backend returned an empty response for task blocking");
          }
          return `Blocked task.\n${formatTaskDetails(task)}`;
        }
      })
    }
  };
};
