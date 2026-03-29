/**
 * @fileoverview Tests for Telegram todo progress formatting and runtime bridge delivery.
 *
 * Exports/constructs:
 * - describe("telegram todo progress helper", ...) - verifies todo extraction and formatting.
 * - describe("TelegramOpenCodeRuntimeBridge todo progress", ...) - verifies Telegram replace updates for todowrite.
 */

import { TelegramOpenCodeRuntimeBridge } from "../telegram-opencode-runtime-bridge.service";
import {
  extractTodoItemsFromToolPart,
  formatTelegramTodoProgressMessage
} from "../telegram-todo-progress";

const makeBridge = () => {
  /* Keep dependencies minimal so the test exercises only todo-specific routing. */
  const config = {
    telegramBotToken: "token",
    telegramMiniappShortName: "miniapp",
    publicBaseUrl: "http://localhost:4173"
  } as any;

  const events = {
    subscribe: jest.fn()
  } as any;

  const routes = {
    resolve: jest.fn(() => ({ adminId: 10, directory: "/tmp/demo" }))
  } as any;

  const outbox = {
    enqueueAssistantStreamDelta: jest.fn(),
    enqueueProgressReplace: jest.fn(),
    closeAssistantProgress: jest.fn(),
    enqueueThinkingControl: jest.fn(),
    enqueueStreamNotification: jest.fn(),
    enqueueAdminNotification: jest.fn()
  } as any;

  const diffPreviews = {
    create: jest.fn()
  } as any;

  return {
    bridge: new TelegramOpenCodeRuntimeBridge(config, events, routes, outbox, diffPreviews),
    outbox
  };
};

describe("telegram todo progress helper", () => {
  it("extracts todos from todowrite metadata and formats a readable checklist", () => {
    /* Todo lists should reach Telegram as a concise checklist with completion counters. */
    const todos = extractTodoItemsFromToolPart({
      state: {
        metadata: {
          todos: [
            { id: "1", content: "Проверить <конфиг>", status: "completed", priority: "high" },
            { id: "2", content: "Обновить сервер", status: "in_progress", priority: "high" },
            { id: "3", content: "Проверить Telegram", status: "pending", priority: "medium" }
          ]
        }
      }
    });

    expect(todos).toEqual([
      { id: "1", content: "Проверить <конфиг>", status: "completed", priority: "high" },
      { id: "2", content: "Обновить сервер", status: "in_progress", priority: "high" },
      { id: "3", content: "Проверить Telegram", status: "pending", priority: "medium" }
    ]);

    const formatted = formatTelegramTodoProgressMessage(todos);
    expect(formatted).toContain("<b>📋 Задачи</b>");
    expect(formatted).toContain("<b>1 из 3 задач завершено</b>");
    expect(formatted).toContain("✅ <s>Проверить &lt;конфиг&gt;</s>");
    expect(formatted).toContain("✴️ Обновить сервер");
    expect(formatted).toContain("▶️ Проверить Telegram");
  });

});

describe("TelegramOpenCodeRuntimeBridge todo progress", () => {
  it("sends a fresh full Telegram checklist for every completed todowrite update", () => {
    /* Each runtime todo snapshot should arrive as a new full message so the latest checklist stays visible at the bottom of chat. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "todo-part-1",
        sessionID: "session-todo",
        tool: "todowrite",
        state: {
          status: "completed",
          metadata: {
            todos: [
              { id: "1", content: "Подключить сервер", status: "in_progress", priority: "high" },
              { id: "2", content: "Обновить контейнеры", status: "pending", priority: "high" }
            ]
          }
        }
      }
    });

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "todo-part-2",
        sessionID: "session-todo",
        tool: "todowrite",
        state: {
          status: "completed",
          metadata: {
            todos: [
              { id: "1", content: "Подключить сервер", status: "completed", priority: "high" },
              { id: "2", content: "Обновить контейнеры", status: "in_progress", priority: "high" }
            ]
          }
        }
      }
    });

    expect(outbox.enqueueProgressReplace).not.toHaveBeenCalled();
    expect(outbox.enqueueAdminNotification).toHaveBeenCalledTimes(2);
    expect(outbox.enqueueAdminNotification).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        adminId: 10,
        parseMode: "HTML",
        text: expect.stringContaining("<b>0 из 2 задач завершено</b>")
      })
    );
    expect(outbox.enqueueAdminNotification).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        adminId: 10,
        parseMode: "HTML",
        text: expect.stringContaining("✅ <s>Подключить сервер</s>")
      })
    );
  });

  it("preserves already completed todos when a later snapshot omits them", () => {
    /* OpenCode sometimes rewrites a shorter todo array, but Telegram should not lose completed items mid-turn. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "todo-part-a",
        sessionID: "session-stable",
        tool: "todowrite",
        state: {
          status: "completed",
          metadata: {
            todos: [
              { content: "Подготовить runtime", status: "completed", priority: "high" },
              { content: "Прогнать smoke", status: "in_progress", priority: "high" },
              { content: "Обновить отчет", status: "pending", priority: "medium" }
            ]
          }
        }
      }
    });

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "todo-part-b",
        sessionID: "session-stable",
        tool: "todowrite",
        state: {
          status: "completed",
          metadata: {
            todos: [
              { content: "Прогнать smoke", status: "in_progress", priority: "high" },
              { content: "Обновить отчет", status: "in_progress", priority: "medium" }
            ]
          }
        }
      }
    });

    expect(outbox.enqueueAdminNotification).toHaveBeenCalledTimes(2);
    const secondCall = outbox.enqueueAdminNotification.mock.calls[1][0];
    expect(secondCall.text).toContain("<b>1 из 3 задач завершено</b>");
    expect(secondCall.text).toContain("✅ <s>Подготовить runtime</s>");
  });

  it("ignores late regressing snapshots once a newer todo state was already rendered", () => {
    /* Out-of-order todowrite events must never roll Telegram progress backward. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "todo-part-1",
        sessionID: "session-regress",
        tool: "todowrite",
        state: {
          status: "completed",
          metadata: {
            todos: [
              { content: "Шаг 1", status: "completed", priority: "high" },
              { content: "Шаг 2", status: "completed", priority: "high" },
              { content: "Шаг 3", status: "in_progress", priority: "high" }
            ]
          }
        }
      }
    });

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "todo-part-older",
        sessionID: "session-regress",
        tool: "todowrite",
        state: {
          status: "completed",
          metadata: {
            todos: [
              { content: "Шаг 1", status: "completed", priority: "high" },
              { content: "Шаг 2", status: "pending", priority: "high" },
              { content: "Шаг 3", status: "pending", priority: "high" }
            ]
          }
        }
      }
    });

    expect(outbox.enqueueProgressReplace).not.toHaveBeenCalled();
    expect(outbox.enqueueAdminNotification).toHaveBeenCalledTimes(1);
    expect(outbox.enqueueAdminNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("<b>2 из 3 задач завершено</b>")
      })
    );
  });

  it("sends a full checklist snapshot each time todo state advances during one turn", () => {
    /* Every progress change should produce one complete checklist message instead of tiny per-task deltas. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "todo-part-seq-1",
        sessionID: "session-separate-messages",
        tool: "todowrite",
        state: {
          status: "completed",
          metadata: {
            todos: [
              { id: "1", content: "Подготовить план", status: "in_progress", priority: "high" },
              { id: "2", content: "Сделать проверку", status: "pending", priority: "medium" }
            ]
          }
        }
      }
    });
    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "todo-part-seq-2",
        sessionID: "session-separate-messages",
        tool: "todowrite",
        state: {
          status: "completed",
          metadata: {
            todos: [
              { id: "1", content: "Подготовить план", status: "completed", priority: "high" },
              { id: "2", content: "Сделать проверку", status: "in_progress", priority: "medium" }
            ]
          }
        }
      }
    });
    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "todo-part-seq-3",
        sessionID: "session-separate-messages",
        tool: "todowrite",
        state: {
          status: "completed",
          metadata: {
            todos: [
              { id: "1", content: "Подготовить план", status: "completed", priority: "high" },
              { id: "2", content: "Сделать проверку", status: "completed", priority: "medium" }
            ]
          }
        }
      }
    });

    expect(outbox.enqueueProgressReplace).not.toHaveBeenCalled();
    expect(outbox.enqueueAdminNotification).toHaveBeenCalledTimes(3);
    expect(outbox.enqueueAdminNotification.mock.calls[0][0].text).toContain("✴️ Подготовить план");
    expect(outbox.enqueueAdminNotification.mock.calls[0][0].text).toContain("▶️ Сделать проверку");
    expect(outbox.enqueueAdminNotification.mock.calls[1][0].text).toContain("✅ <s>Подготовить план</s>");
    expect(outbox.enqueueAdminNotification.mock.calls[1][0].text).toContain("✴️ Сделать проверку");
    expect(outbox.enqueueAdminNotification.mock.calls[2][0].text).toContain("✅ <s>Подготовить план</s>");
    expect(outbox.enqueueAdminNotification.mock.calls[2][0].text).toContain("✅ <s>Сделать проверку</s>");
  });

  it("starts a new todo progress slot on the next turn so old completed items do not leak forever", () => {
    /* Each new OpenCode turn deserves a fresh checklist instead of carrying the previous turn's completed items. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).onEvent({
      type: "opencode.turn.started",
      ts: new Date().toISOString(),
      data: {
        adminId: 10,
        projectSlug: "demo",
        directory: "/tmp/demo",
        sessionId: "session-reset"
      }
    });
    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "todo-turn-1",
        sessionID: "session-reset",
        tool: "todowrite",
        state: {
          status: "completed",
          metadata: {
            todos: [
              { content: "Старый шаг", status: "completed", priority: "high" },
              { content: "Старый хвост", status: "pending", priority: "medium" }
            ]
          }
        }
      }
    });

    (bridge as any).onEvent({
      type: "opencode.turn.started",
      ts: new Date().toISOString(),
      data: {
        adminId: 10,
        projectSlug: "demo",
        directory: "/tmp/demo",
        sessionId: "session-reset"
      }
    });
    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "todo-turn-2",
        sessionID: "session-reset",
        tool: "todowrite",
        state: {
          status: "completed",
          metadata: {
            todos: [
              { content: "Новый шаг", status: "in_progress", priority: "high" }
            ]
          }
        }
      }
    });

    expect(outbox.enqueueProgressReplace).not.toHaveBeenCalled();
    expect(outbox.enqueueAdminNotification).toHaveBeenCalledTimes(2);
    const firstCall = outbox.enqueueAdminNotification.mock.calls[0][0];
    const secondCall = outbox.enqueueAdminNotification.mock.calls[1][0];
    expect(firstCall.text).toContain("Старый шаг");
    expect(secondCall.text).toContain("Новый шаг");
    expect(secondCall.text).not.toContain("Старый шаг");
  });
});
