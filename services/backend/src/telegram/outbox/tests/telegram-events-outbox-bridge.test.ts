/**
 * @fileoverview Tests for bridging backend events into Telegram outbox.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { EventsService } from "../../../events/events.service";
import { TelegramStreamStore } from "../../telegram-stream.store";
import { TelegramOutboxStore } from "../telegram-outbox.store";
import { TelegramOutboxService } from "../telegram-outbox.service";
import { TelegramEventsOutboxBridge } from "../telegram-events-outbox-bridge.service";

const readOutboxItems = (): any[] => {
  const outboxPath = path.join(process.cwd(), "data", "telegram.outbox.json");
  if (!fs.existsSync(outboxPath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(outboxPath, "utf-8")) as any;
  return Array.isArray(parsed?.items) ? parsed.items : [];
};

describe("TelegramEventsOutboxBridge", () => {
  test("routes project.lifecycle into admin notification", () => {
    /* Isolate cwd to avoid polluting local ./data. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-bridge-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const config = {
        telegramBotToken: "x",
        adminIds: [1],
        publicBaseUrl: "http://localhost:4173",
        publicDomain: "localhost",
        projectsRoot: tmp,
        opencodeServerUrl: "http://localhost",
        eventBufferSize: 10
      };

      /* Bind admin to chat so outbox can deliver. */
      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 123);
      streamStore.setStreamEnabled(1, true);

      const outboxStore = new TelegramOutboxStore();
      const outboxService = new TelegramOutboxService(streamStore, outboxStore);
      const events = new EventsService(config as any);
      const bridge = new TelegramEventsOutboxBridge(events, outboxService);
      bridge.onModuleInit();

      events.publish({
        type: "project.lifecycle",
        ts: new Date().toISOString(),
        data: {
          adminId: 1,
          slug: "demo",
          action: "start",
          containers: [
            { service: "web", state: "running", ports: ["0.0.0.0:8080->80"] },
            { service: "db", state: "exited", ports: [] }
          ]
        }
      });

      const items = readOutboxItems();
      expect(items.length).toBe(1);
      expect(items[0].chatId).toBe(123);
      expect(items[0].text).toContain("Запуск проекта");
      expect(items[0].text).toContain("web: running");
      expect(items[0].text).toContain("db: exited");
    } finally {
      process.chdir(prev);
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  test("reuses streamed assistant message for final single-chunk reply", () => {
    /* Final answer should replace the live streamed message instead of duplicating it. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-bridge-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const config = {
        telegramBotToken: "x",
        adminIds: [1],
        publicBaseUrl: "http://localhost:4173",
        publicDomain: "localhost",
        projectsRoot: tmp,
        opencodeServerUrl: "http://localhost",
        eventBufferSize: 10
      };

      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 123);
      streamStore.setStreamEnabled(1, true);

      const outboxStore = new TelegramOutboxStore();
      const outboxService = new TelegramOutboxService(streamStore, outboxStore);
      const events = new EventsService(config as any);
      const bridge = new TelegramEventsOutboxBridge(events, outboxService);
      bridge.onModuleInit();

      events.publish({
        type: "opencode.message",
        ts: new Date().toISOString(),
        data: {
          adminId: 1,
          sessionId: "session-1",
          text: "Готовый ответ",
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          thinking: "medium",
          agent: "build",
          tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }
        }
      });

      const items = readOutboxItems();
      const assistantItems = items.filter((item) => item.control == null);
      expect(assistantItems.length).toBe(1);
      expect(assistantItems[0].mode).toBe("replace");
      expect(assistantItems[0].progressKey).toBe("assistant:1:session-1:1");
      expect(assistantItems[0].text).toContain("Готовый ответ");
      expect(assistantItems[0].text).toContain("<blockquote>");
      expect(assistantItems[0].text).toContain("cliproxy/gpt-5.4");
    } finally {
      process.chdir(prev);
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  test("starts a fresh streamed message for the next reply in the same session", () => {
    /* Reusing the same progress key across prompts would rewrite the previous answer in chat history. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-bridge-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const config = {
        telegramBotToken: "x",
        adminIds: [1],
        publicBaseUrl: "http://localhost:4173",
        publicDomain: "localhost",
        projectsRoot: tmp,
        opencodeServerUrl: "http://localhost",
        eventBufferSize: 10
      };

      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 123);
      streamStore.setStreamEnabled(1, true);

      const outboxStore = new TelegramOutboxStore();
      const outboxService = new TelegramOutboxService(streamStore, outboxStore);
      const events = new EventsService(config as any);
      const bridge = new TelegramEventsOutboxBridge(events, outboxService);
      bridge.onModuleInit();

      events.publish({
        type: "opencode.message",
        ts: new Date().toISOString(),
        data: {
          adminId: 1,
          sessionId: "session-1",
          text: "Первый ответ",
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          thinking: "medium",
          agent: "build",
          tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }
        }
      });

      events.publish({
        type: "opencode.message",
        ts: new Date().toISOString(),
        data: {
          adminId: 1,
          sessionId: "session-1",
          text: "Второй ответ",
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          thinking: "medium",
          agent: "build",
          tokens: { input: 12, output: 18, reasoning: 0, cache: { read: 0, write: 0 } }
        }
      });

      const assistantItems = readOutboxItems().filter((item) => item.control == null);
      expect(assistantItems).toHaveLength(2);
      expect(assistantItems[0].progressKey).toBe("assistant:1:session-1:1");
      expect(assistantItems[1].progressKey).toBe("assistant:1:session-1:2");
    } finally {
      process.chdir(prev);
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  test("uses finalText for Telegram reply when OpenCode transcript contains earlier streamed commentary", () => {
    /* The final Telegram replace must contain only the true final assistant block instead of the whole accumulated transcript. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-bridge-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const config = {
        telegramBotToken: "x",
        adminIds: [1],
        publicBaseUrl: "http://localhost:4173",
        publicDomain: "localhost",
        projectsRoot: tmp,
        opencodeServerUrl: "http://localhost",
        eventBufferSize: 10
      };

      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 123);
      streamStore.setStreamEnabled(1, true);

      const outboxStore = new TelegramOutboxStore();
      const outboxService = new TelegramOutboxService(streamStore, outboxStore);
      const events = new EventsService(config as any);
      const bridge = new TelegramEventsOutboxBridge(events, outboxService);
      bridge.onModuleInit();

      events.publish({
        type: "opencode.message",
        ts: new Date().toISOString(),
        data: {
          adminId: 1,
          sessionId: "session-1",
          text: "Понял задачу.Сейчас проверю compose.Нашел проблему и исправил.",
          finalText: "Нашел проблему и исправил.",
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          thinking: "medium",
          agent: "build",
          tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }
        }
      });

      const assistantItems = readOutboxItems().filter((item) => item.control == null);
      expect(assistantItems).toHaveLength(1);
      expect(assistantItems[0].text).toContain("Нашел проблему и исправил.");
      expect(assistantItems[0].text).not.toContain("Понял задачу.");
      expect(assistantItems[0].text).not.toContain("Сейчас проверю compose.");
    } finally {
      process.chdir(prev);
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  test("falls back to text when upstream finalText is blank", () => {
    /* Empty trailing text extraction must not erase the final answer or its footer. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-bridge-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const config = {
        telegramBotToken: "x",
        adminIds: [1],
        publicBaseUrl: "http://localhost:4173",
        publicDomain: "localhost",
        projectsRoot: tmp,
        opencodeServerUrl: "http://localhost",
        eventBufferSize: 10
      };

      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 123);
      streamStore.setStreamEnabled(1, false);

      const outboxStore = new TelegramOutboxStore();
      const outboxService = new TelegramOutboxService(streamStore, outboxStore);
      const events = new EventsService(config as any);
      const bridge = new TelegramEventsOutboxBridge(events, outboxService);
      bridge.onModuleInit();

      events.publish({
        type: "opencode.message",
        ts: new Date().toISOString(),
        data: {
          adminId: 1,
          sessionId: "session-1",
          text: "Финальный текст целиком",
          finalText: "   ",
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          thinking: "medium",
          agent: "build",
          tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }
        }
      });

      const assistantItems = readOutboxItems().filter((item) => item.control == null);
      expect(assistantItems).toHaveLength(1);
      expect(assistantItems[0].text).toContain("Финальный текст целиком");
      expect(assistantItems[0].text).toContain("<blockquote>");
    } finally {
      process.chdir(prev);
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });
});
