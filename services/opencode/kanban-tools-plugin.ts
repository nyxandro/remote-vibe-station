/**
 * @fileoverview OpenCode local plugin that exposes kanban task tools backed by the backend API.
 *
 * Exports:
 * - KanbanToolsPlugin - Registers task listing, creation, planning/refinement, criterion updates, claiming, and completion tools.
 *
 * Key constructs:
 * - CREATE_TASK_DESCRIPTION - LLM-facing contract for single-task creation payloads.
 * - REFINE_TASK_DESCRIPTION - LLM-facing contract for safe task planning payloads.
 * - criterionInputSchema - Shared criterion schema that accepts string or structured checklist items.
 * - formatTaskDetails - Renders stable task identifiers and checklist state for agent follow-up calls.
 */

import { type Plugin, tool } from "@opencode-ai/plugin";

const STATUS_OPTIONS = ["backlog", "refinement", "ready", "queued", "in_progress", "blocked", "done"] as const;
const PRIORITY_OPTIONS = ["low", "medium", "high"] as const;
const CRITERION_STATUS_OPTIONS = ["pending", "done", "blocked"] as const;
const DEFAULT_AGENT_ID = "opencode-agent";
const DEFAULT_LIMIT = 20;
const DEFAULT_LEASE_MS = 2 * 60 * 60 * 1000;

/* Tool descriptions are the first line of defense against malformed LLM-generated payload shapes. */
const CREATE_TASK_DESCRIPTION = [
  "Create exactly one kanban task per call.",
  "Send a single JSON object, never an array and never { tasks: [...] }.",
  "Required: title.",
  "Optional: projectSlug, description, status, priority, acceptanceCriteria.",
  "acceptanceCriteria may be plain strings or full criterion objects with text plus optional id/status/blockedReason.",
  "Allowed status values: backlog, refinement (Plan), ready, queued, in_progress, blocked, done.",
  "Allowed priority values: low, medium, high.",
  "Omit projectSlug only when the current directory already maps to the project."
].join(" ");

const REFINE_TASK_DESCRIPTION = [
  "Plan or refine exactly one existing task.",
  "Send taskId plus only the fields you want to change.",
  "Omit acceptanceCriteria entirely when you want to leave the current checklist unchanged.",
  "If you replace acceptanceCriteria, send the full list; plain strings are preferred, but criterion objects with id/text/status/blockedReason are accepted.",
  "Never send acceptanceCriteria: [] unless you also set clearAcceptanceCriteria: true for an intentional checklist clear.",
  "Use kanban_update_criterion to change the status of one existing criterion during execution instead of sending a partial criterion-status patch here.",
  "Use this tool to tighten scope, move cards through Plan/refinement, ready, and queue stages, and keep the checklist accurate before or during execution."
].join(" ");

type KanbanCriterionInput =
  | string
  | {
      id?: string;
      text: string;
      status?: (typeof CRITERION_STATUS_OPTIONS)[number];
      blockedReason?: string | null;
    };

/* Mirror the backend criterion contract so models can safely echo structured checklist items from prior tool output. */
const criterionInputSchema = tool.schema.union([
  tool.schema.string(),
  tool.schema.object({
    id: tool.schema.string().optional(),
    text: tool.schema.string(),
    status: tool.schema.enum(CRITERION_STATUS_OPTIONS).optional(),
    blockedReason: tool.schema.string().nullable().optional()
  })
]);

/* Reuse the same array schema across create/refine so the agent sees one stable input shape. */
const criterionInputsSchema = tool.schema.array(criterionInputSchema).optional();

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

const EXECUTION_CONFLICT_CODE = "KANBAN_EXECUTION_OWNERSHIP_CONFLICT";

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

const isExecutionOwnershipConflict = (error: unknown): boolean => {
  /* Ownership conflicts are expected control-flow once another session already owns the task. */
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(EXECUTION_CONFLICT_CODE);
};

const formatExecutionOwnershipConflict = (error: unknown): string => {
  /* Return a normal tool result so the agent can stop working on a stolen task without red-stack noise. */
  const message = error instanceof Error ? error.message : String(error);
  return [
    "Task execution already belongs to another OpenCode session.",
    "Stop working on this task in the current session and refresh the kanban state.",
    message
  ].join("\n");
};

const humanizeStatus = (status: KanbanTask["status"]): string => {
  /* Keep tool output conversational so users see workflow states without backend-style snake_case labels. */
  switch (status) {
    case "backlog":
      return "Backlog";
    case "refinement":
      return "Plan";
    case "ready":
      return "Ready";
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
  /* Detailed card view gives the agent enough context for planning and implementation decisions. */
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
        description: CREATE_TASK_DESCRIPTION,
        args: {
          projectSlug: tool.schema.string().optional(),
          title: tool.schema.string(),
          description: tool.schema.string().optional(),
          status: tool.schema.enum(STATUS_OPTIONS).optional(),
          priority: tool.schema.enum(PRIORITY_OPTIONS).optional(),
          acceptanceCriteria: criterionInputsSchema
        },
        async execute(args, context) {
          const task = await postJson<KanbanTask>("/api/kanban/agent/create", {
            projectSlug: args.projectSlug,
            currentDirectory: context.directory,
            title: args.title,
            description: args.description ?? "",
            status: args.status ?? "backlog",
            priority: args.priority ?? "medium",
            acceptanceCriteria: (args.acceptanceCriteria ?? []) as KanbanCriterionInput[]
          });
          if (!task) {
            throw new Error("Kanban backend returned an empty response for task creation");
          }
          return `Created task.\n${formatTaskDetails(task)}`;
        }
      }),

      kanban_refine_task: tool({
        description: REFINE_TASK_DESCRIPTION,
        args: {
          agentId: tool.schema.string().optional(),
          taskId: tool.schema.string(),
          title: tool.schema.string().optional(),
          description: tool.schema.string().optional(),
          status: tool.schema.enum(STATUS_OPTIONS).optional(),
          priority: tool.schema.enum(PRIORITY_OPTIONS).optional(),
          acceptanceCriteria: criterionInputsSchema,
          clearAcceptanceCriteria: tool.schema.boolean().optional(),
          resultSummary: tool.schema.string().optional(),
          blockedReason: tool.schema.string().optional()
        },
        async execute(args, context) {
          let task: KanbanTask | null;
          try {
            task = await postJson<KanbanTask>(`/api/kanban/agent/tasks/${encodeURIComponent(args.taskId)}/refine`, {
              ...args,
              agentId: args.agentId ?? DEFAULT_AGENT_ID,
              sessionId: context.sessionID
            });
          } catch (error) {
            if (isExecutionOwnershipConflict(error)) {
              return formatExecutionOwnershipConflict(error);
            }
            throw error;
          }
          if (!task) {
            throw new Error("Kanban backend returned an empty response for task planning");
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
        async execute(args, context) {
          let task: KanbanTask | null;
          try {
            task = await postJson<KanbanTask>(
              `/api/kanban/agent/tasks/${encodeURIComponent(args.taskId)}/criteria/${encodeURIComponent(args.criterionId)}/update`,
              {
                agentId: DEFAULT_AGENT_ID,
                sessionId: context.sessionID,
                status: args.status,
                blockedReason: args.blockedReason ?? null
              }
            );
          } catch (error) {
            if (isExecutionOwnershipConflict(error)) {
              return formatExecutionOwnershipConflict(error);
            }
            throw error;
          }
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
            sessionId: context.sessionID,
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
        async execute(args, context) {
          let task: KanbanTask | null;
          try {
            task = await postJson<KanbanTask>(`/api/kanban/agent/tasks/${encodeURIComponent(args.taskId)}/complete`, {
              agentId: DEFAULT_AGENT_ID,
              sessionId: context.sessionID,
              resultSummary: args.resultSummary ?? null
            });
          } catch (error) {
            if (isExecutionOwnershipConflict(error)) {
              return formatExecutionOwnershipConflict(error);
            }
            throw error;
          }
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
        async execute(args, context) {
          let task: KanbanTask | null;
          try {
            task = await postJson<KanbanTask>(`/api/kanban/agent/tasks/${encodeURIComponent(args.taskId)}/block`, {
              agentId: DEFAULT_AGENT_ID,
              sessionId: context.sessionID,
              reason: args.reason ?? null
            });
          } catch (error) {
            if (isExecutionOwnershipConflict(error)) {
              return formatExecutionOwnershipConflict(error);
            }
            throw error;
          }
          if (!task) {
            throw new Error("Kanban backend returned an empty response for task blocking");
          }
          return `Blocked task.\n${formatTaskDetails(task)}`;
        }
      })
    }
  };
};
