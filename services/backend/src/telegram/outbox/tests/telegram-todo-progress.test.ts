/**
 * @fileoverview Tests for Telegram todo progress formatting and runtime bridge delivery.
 *
 * Exports/constructs:
 * - describe("telegram todo progress helper", ...) - verifies todo extraction and formatting.
 * - describe("TelegramOpenCodeRuntimeBridge todo progress", ...) - verifies Telegram replace updates for todowrite.
 */

import { TelegramOpenCodeRuntimeBridge } from "../telegram-opencode-runtime-bridge.service";
import {
  buildTodoProgressKey,
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
            { id: "1", content: "Проверить конфиг", status: "completed", priority: "high" },
            { id: "2", content: "Обновить сервер", status: "in_progress", priority: "high" },
            { id: "3", content: "Проверить Telegram", status: "pending", priority: "medium" }
          ]
        }
      }
    });

    expect(todos).toEqual([
      { id: "1", content: "Проверить конфиг", status: "completed", priority: "high" },
      { id: "2", content: "Обновить сервер", status: "in_progress", priority: "high" },
      { id: "3", content: "Проверить Telegram", status: "pending", priority: "medium" }
    ]);
    expect(formatTelegramTodoProgressMessage(todos)).toContain("1 из 3 задач завершено");
    expect(formatTelegramTodoProgressMessage(todos)).toContain("[x] Проверить конфиг");
    expect(formatTelegramTodoProgressMessage(todos)).toContain("[-] Обновить сервер");
    expect(formatTelegramTodoProgressMessage(todos)).toContain("[ ] Проверить Telegram");
  });
});

describe("TelegramOpenCodeRuntimeBridge todo progress", () => {
  it("updates one Telegram todo message for repeated todowrite calls in the same session", () => {
    /* Todo list changes should edit one live Telegram message instead of spamming the chat. */
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

    expect(outbox.enqueueProgressReplace).toHaveBeenCalledTimes(2);
    expect(outbox.enqueueProgressReplace).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        adminId: 10,
        progressKey: buildTodoProgressKey(10, "session-todo"),
        text: expect.stringContaining("0 из 2 задач завершено")
      })
    );
    expect(outbox.enqueueProgressReplace).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        adminId: 10,
        progressKey: buildTodoProgressKey(10, "session-todo"),
        text: expect.stringContaining("1 из 2 задач завершено")
      })
    );
  });
});
