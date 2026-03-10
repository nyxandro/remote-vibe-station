/**
 * @fileoverview OpenCode local plugin that exposes kanban task tools backed by the backend API.
 *
 * Exports:
 * - KanbanToolsPlugin - Registers task listing, refinement, claiming, and completion tools.
 */

import { type Plugin, tool } from "@opencode-ai/plugin";

const STATUS_OPTIONS = ["backlog", "queued", "in_progress", "blocked", "done"] as const;
const PRIORITY_OPTIONS = ["low", "medium", "high"] as const;
const DEFAULT_AGENT_ID = "opencode-agent";
const DEFAULT_LIMIT = 20;
const DEFAULT_LEASE_MS = 2 * 60 * 60 * 1000;

type KanbanTask = {
  id: string;
  projectSlug: string;
  projectName: string;
  title: string;
  description: string;
  status: (typeof STATUS_OPTIONS)[number];
  priority: (typeof PRIORITY_OPTIONS)[number];
  acceptanceCriteria: string[];
  resultSummary: string | null;
  blockedReason: string | null;
  updatedAt: string;
  claimedBy: string | null;
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
    throw new Error(`Kanban backend request failed: ${response.status} ${await response.text()}`);
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

const formatTaskLine = (task: KanbanTask): string => {
  /* Surface task content instead of internal ids so backlog discussions stay human-readable. */
  const lines = [
    `- ${task.title}`,
    `  Status: ${humanizeStatus(task.status)} | Priority: ${humanizePriority(task.priority)} | Project: ${task.projectName}`
  ];

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
    `project: ${task.projectName} (${task.projectSlug})`,
    `status: ${humanizeStatus(task.status)}`,
    `priority: ${humanizePriority(task.priority)}`
  ];

  if (task.description) {
    lines.push(`description: ${task.description}`);
  }
  if (task.acceptanceCriteria.length > 0) {
    lines.push(`acceptance: ${task.acceptanceCriteria.join(" | ")}`);
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
        description: "List kanban tasks for the current project or all projects.",
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
        description: "Create a new kanban task in backlog or queue.",
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
        description: "Refine an existing backlog task and optionally move it to queue.",
        args: {
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
          const task = await postJson<KanbanTask>(`/api/kanban/agent/tasks/${encodeURIComponent(args.taskId)}/refine`, args);
          if (!task) {
            throw new Error("Kanban backend returned an empty response for task refinement");
          }
          return `Updated task.\n${formatTaskDetails(task)}`;
        }
      }),

      kanban_claim_next: tool({
        description: "Claim the next queued task for the current project.",
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
        description: "Mark a claimed task as done with a short result summary.",
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
        description: "Mark a task as blocked with the reason the agent cannot continue.",
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
