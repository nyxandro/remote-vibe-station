/**
 * @fileoverview Todo progress extraction and formatting for Telegram runtime updates.
 *
 * Exports:
 * - TelegramTodoItem - normalized todo item shape extracted from OpenCode todowrite payloads.
 * - buildTodoProgressKey - returns stable Telegram replace key for one OpenCode session todo list.
 * - extractTodoItemsFromToolPart - extracts todo items from todowrite metadata/input/output payloads.
 * - formatTelegramTodoProgressMessage - renders a compact checklist for Telegram chat updates.
 */

type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TelegramTodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
  priority: string | null;
};

const MAX_TODO_LINES = 20;

const normalizeTodoStatus = (value: unknown): TodoStatus | null => {
  /* OpenCode stores todo status as short strings; ignore unknown states to avoid noisy Telegram output. */
  if (typeof value !== "string") {
    return null;
  }

  if (value === "pending" || value === "in_progress" || value === "completed" || value === "cancelled") {
    return value;
  }

  return null;
};

const normalizeTodoItems = (value: unknown): TelegramTodoItem[] => {
  /* Accept only explicit todo arrays with readable content so malformed tool payloads are ignored safely. */
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    const status = normalizeTodoStatus(record.status);
    const id = typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : `${index + 1}`;
    const priority = typeof record.priority === "string" && record.priority.trim().length > 0 ? record.priority.trim() : null;
    if (!content || !status) {
      return [];
    }

    return [{ id, content, status, priority }];
  });
};

const parseTodoItemsFromOutput = (value: unknown): TelegramTodoItem[] => {
  /* Some OpenCode builds serialize todo arrays into state.output as JSON text instead of metadata.todos. */
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  try {
    return normalizeTodoItems(JSON.parse(value));
  } catch {
    return [];
  }
};

const toTodoMarker = (status: TodoStatus): string => {
  /* Plain-text markers survive Telegram edits reliably and visually match the CLI todo list mental model. */
  if (status === "completed") {
    return "[x]";
  }

  if (status === "in_progress") {
    return "[-]";
  }

  if (status === "cancelled") {
    return "[~]";
  }

  return "[ ]";
};

export const buildTodoProgressKey = (adminId: number, sessionID: string): string => {
  /* One Telegram replace slot per OpenCode session keeps todo updates together in chat history. */
  return `todo:${adminId}:${sessionID}`;
};

export const extractTodoItemsFromToolPart = (part: { state?: Record<string, unknown> | null }): TelegramTodoItem[] => {
  /* Try the structured payloads first, then fall back to JSON output parsing for older runtime shapes. */
  const state = part.state ?? {};
  const metadata = state.metadata && typeof state.metadata === "object" ? (state.metadata as Record<string, unknown>) : {};
  const input = state.input && typeof state.input === "object" ? (state.input as Record<string, unknown>) : {};

  const fromMetadata = normalizeTodoItems(metadata.todos);
  if (fromMetadata.length > 0) {
    return fromMetadata;
  }

  const fromInput = normalizeTodoItems(input.todos);
  if (fromInput.length > 0) {
    return fromInput;
  }

  return parseTodoItemsFromOutput(state.output);
};

export const formatTelegramTodoProgressMessage = (todos: TelegramTodoItem[]): string => {
  /* Telegram should receive one compact checklist message that can be edited in place as task state changes. */
  const total = todos.length;
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const lines = [`📋 Задачи`, "", `${completed} из ${total} задач завершено`];

  if (total === 0) {
    lines.push("", "Список задач пока пуст.");
    return lines.join("\n");
  }

  lines.push("");
  todos.slice(0, MAX_TODO_LINES).forEach((todo) => {
    lines.push(`${toTodoMarker(todo.status)} ${todo.content}`);
  });

  if (todos.length > MAX_TODO_LINES) {
    lines.push(`...ещё ${todos.length - MAX_TODO_LINES}`);
  }

  return lines.join("\n");
};
