/**
 * @fileoverview Monotonic todo-progress tracker for Telegram runtime updates.
 *
 * Exports:
 * - TelegramRuntimeTodoProgressUpdate - Render payload for one live Telegram todo checklist update.
 * - TelegramRuntimeTodoProgress - Tracks one canonical todo list per OpenCode turn and suppresses regressions.
 */

import { TelegramTodoItem, formatTelegramTodoProgressMessage } from "./telegram-todo-progress";

export type TelegramRuntimeTodoProgressUpdate = {
  progressKey: string;
  text: string;
};

type TrackedTodoSession = {
  adminId: number;
  progressKey: string;
  items: TelegramTodoItem[];
  lastRenderedText: string | null;
};

const FINAL_TODO_STATUSES = new Set<TelegramTodoItem["status"]>(["completed", "cancelled"]);

const dedupeTodoItems = (todos: TelegramTodoItem[]): TelegramTodoItem[] => {
  /* Later duplicates for the same logical todo id should win because they represent newer runtime state. */
  const latestById = new Map<string, TelegramTodoItem>();
  for (const todo of todos) {
    latestById.set(todo.id, todo);
  }

  return todos.filter((todo) => latestById.get(todo.id) === todo);
};

const getTodoStatusRank = (status: TelegramTodoItem["status"]): number => {
  /* Todo progress must stay monotonic inside one turn so late stale events cannot move work backwards. */
  if (status === "pending") {
    return 0;
  }

  if (status === "in_progress") {
    return 1;
  }

  return 2;
};

const mergeTodoItems = (previous: TelegramTodoItem, incoming: TelegramTodoItem): TelegramTodoItem => {
  /* Keep the furthest status reached in this turn unless the incoming update is equally final. */
  const previousRank = getTodoStatusRank(previous.status);
  const incomingRank = getTodoStatusRank(incoming.status);

  if (incomingRank > previousRank) {
    return incoming;
  }

  if (incomingRank < previousRank) {
    return {
      ...incoming,
      status: previous.status
    };
  }

  return incoming;
};

const shouldResetTrackedTodos = (existing: TelegramTodoItem[], incoming: TelegramTodoItem[]): boolean => {
  /* A zero-overlap snapshot is almost certainly a new plan, so old completed tasks should not leak into it. */
  if (existing.length === 0 || incoming.length === 0) {
    return false;
  }

  const incomingIds = new Set(incoming.map((todo) => todo.id));
  return !existing.some((todo) => incomingIds.has(todo.id));
};

const mergeTodoSnapshots = (existing: TelegramTodoItem[], incoming: TelegramTodoItem[]): TelegramTodoItem[] => {
  /* Preserve omitted items on shrink and keep previously completed work visible for the rest of the turn. */
  if (shouldResetTrackedTodos(existing, incoming)) {
    return incoming;
  }

  const incomingById = new Map(incoming.map((todo) => [todo.id, todo]));
  const preserveAllOmittedItems = incoming.length < existing.length;
  const mergedById = new Map<string, TelegramTodoItem>();
  const order: string[] = [];

  for (const todo of existing) {
    const incomingTodo = incomingById.get(todo.id);
    if (incomingTodo) {
      mergedById.set(todo.id, mergeTodoItems(todo, incomingTodo));
      order.push(todo.id);
      continue;
    }

    if (preserveAllOmittedItems || FINAL_TODO_STATUSES.has(todo.status)) {
      mergedById.set(todo.id, todo);
      order.push(todo.id);
    }
  }

  for (const todo of incoming) {
    if (mergedById.has(todo.id)) {
      continue;
    }

    mergedById.set(todo.id, todo);
    order.push(todo.id);
  }

  return order.map((id) => mergedById.get(id)).filter((todo): todo is TelegramTodoItem => Boolean(todo));
};

export class TelegramRuntimeTodoProgress {
  private readonly turnSeqBySession = new Map<string, number>();
  private readonly stateBySession = new Map<string, TrackedTodoSession>();

  public openTurn(sessionID: string): void {
    /* Every explicit turn start gets a fresh replace slot so old todo plans do not bleed into new work. */
    const normalizedSessionID = sessionID.trim();
    if (!normalizedSessionID) {
      return;
    }

    const nextSeq = (this.turnSeqBySession.get(normalizedSessionID) ?? 0) + 1;
    this.turnSeqBySession.set(normalizedSessionID, nextSeq);
    this.stateBySession.delete(normalizedSessionID);
  }

  public closeTurn(sessionID: string): void {
    /* The rendered Telegram checklist should stay in chat, but in-memory merge state must reset after the turn ends. */
    const normalizedSessionID = sessionID.trim();
    if (!normalizedSessionID) {
      return;
    }

    this.stateBySession.delete(normalizedSessionID);
  }

  public applySnapshot(input: {
    adminId: number;
    sessionID: string;
    todos: TelegramTodoItem[];
  }): TelegramRuntimeTodoProgressUpdate | null {
    /* Merge raw todowrite snapshots into one canonical live checklist for the current turn. */
    const normalizedSessionID = input.sessionID.trim();
    if (!normalizedSessionID) {
      return null;
    }

    const dedupedTodos = dedupeTodoItems(input.todos);
    const state = this.getOrCreateSessionState({ adminId: input.adminId, sessionID: normalizedSessionID });
    const mergedTodos = mergeTodoSnapshots(state.items, dedupedTodos);
    const nextText = formatTelegramTodoProgressMessage(mergedTodos);
    if (state.lastRenderedText === nextText) {
      return null;
    }

    state.items = mergedTodos;
    state.lastRenderedText = nextText;

    return {
      progressKey: state.progressKey,
      text: nextText
    };
  }

  private getOrCreateSessionState(input: { adminId: number; sessionID: string }): TrackedTodoSession {
    /* Session state is created lazily because some runtime payloads arrive before the explicit turn-start marker. */
    const existing = this.stateBySession.get(input.sessionID);
    if (existing && existing.adminId === input.adminId) {
      return existing;
    }

    const turnSeq = this.turnSeqBySession.get(input.sessionID) ?? 1;
    this.turnSeqBySession.set(input.sessionID, turnSeq);

    const state: TrackedTodoSession = {
      adminId: input.adminId,
      progressKey: `todo:${input.adminId}:${input.sessionID}:${turnSeq}`,
      items: [],
      lastRenderedText: null
    };
    this.stateBySession.set(input.sessionID, state);
    return state;
  }
}
