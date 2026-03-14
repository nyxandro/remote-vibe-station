/**
 * @fileoverview Tests for Telegram notifications emitted by kanban automation runner events.
 *
 * Exports:
 * - (none)
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

describe("Telegram kanban runner notifications", () => {
  test("routes kanban.runner.finished with started action and new-session note to all configured admins with chat bindings", () => {
    /* Fresh runner-owned work should explicitly tell Telegram that the active thread changed to a new session. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-kanban-runner-started-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const config = {
        telegramBotToken: "x",
        adminIds: [1, 2],
        publicBaseUrl: "http://localhost:4173",
        publicDomain: "localhost",
        projectsRoot: tmp,
        opencodeServerUrl: "http://localhost",
        eventBufferSize: 10
      };

      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 111);
      streamStore.bindAdminChat(2, 222);

      const outboxStore = new TelegramOutboxStore();
      const outboxService = new TelegramOutboxService(streamStore, outboxStore);
      const events = new EventsService(config as any);
      const bridge = new TelegramEventsOutboxBridge(events, outboxService, { finalizeAssistantReply: jest.fn() } as any, config as any);
      bridge.onModuleInit();

      events.publish({
        type: "kanban.runner.finished",
        ts: new Date().toISOString(),
        data: {
          action: "started",
          startedNewSession: true,
          projectSlug: "auto-v-arendu",
          taskId: "task-123",
          taskTitle: "Diagnose and fix smoke E2E failure"
        }
      });

      const items = readOutboxItems();
      expect(items).toHaveLength(2);
      expect(items[0].text).toBe(
        "🤖 Kanban runner взял в работу задачу \"Diagnose and fix smoke E2E failure\" в проекте auto-v-arendu.\n🆕 Начата новая сессия (проект: auto-v-arendu)."
      );
      expect(items[1].text).toBe(
        "🤖 Kanban runner взял в работу задачу \"Diagnose and fix smoke E2E failure\" в проекте auto-v-arendu.\n🆕 Начата новая сессия (проект: auto-v-arendu)."
      );
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("routes kanban.runner.finished without new-session note when runner reused an existing thread", () => {
    /* Telegram copy should stay precise and avoid claiming a new session when the runner simply resumed an existing one. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-kanban-runner-reused-"));
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
      streamStore.bindAdminChat(1, 111);

      const outboxStore = new TelegramOutboxStore();
      const outboxService = new TelegramOutboxService(streamStore, outboxStore);
      const events = new EventsService(config as any);
      const bridge = new TelegramEventsOutboxBridge(events, outboxService, { finalizeAssistantReply: jest.fn() } as any, config as any);
      bridge.onModuleInit();

      events.publish({
        type: "kanban.runner.finished",
        ts: new Date().toISOString(),
        data: {
          action: "started",
          startedNewSession: false,
          projectSlug: "auto-v-arendu",
          taskId: "task-124",
          taskTitle: "Resume existing runner context"
        }
      });

      const items = readOutboxItems();
      expect(items).toHaveLength(1);
      expect(items[0].text).toBe("🤖 Kanban runner взял в работу задачу \"Resume existing runner context\" в проекте auto-v-arendu.");
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("routes kanban.runner.blocked with blocker reason", () => {
    /* Human follow-up should be explicit when automation cannot continue a kanban task on its own. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-kanban-runner-blocked-"));
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
      streamStore.bindAdminChat(1, 111);

      const outboxStore = new TelegramOutboxStore();
      const outboxService = new TelegramOutboxService(streamStore, outboxStore);
      const events = new EventsService(config as any);
      const bridge = new TelegramEventsOutboxBridge(events, outboxService, { finalizeAssistantReply: jest.fn() } as any, config as any);
      bridge.onModuleInit();

      events.publish({
        type: "kanban.runner.blocked",
        ts: new Date().toISOString(),
        data: {
          projectSlug: "sparkas",
          taskId: "task-7",
          taskTitle: "Restore production health checks",
          blockedReason: "Нужен production API token"
        }
      });

      const items = readOutboxItems();
      expect(items).toHaveLength(1);
      expect(items[0].text).toBe("⛔ Kanban runner заблокировал задачу \"Restore production health checks\" в проекте sparkas. Причина: Нужен production API token");
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("routes kanban.runner.error with failure text", () => {
    /* Runner failures should surface quickly so humans know why automatic continuation stopped. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-kanban-runner-error-"));
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
      streamStore.bindAdminChat(1, 111);

      const outboxStore = new TelegramOutboxStore();
      const outboxService = new TelegramOutboxService(streamStore, outboxStore);
      const events = new EventsService(config as any);
      const bridge = new TelegramEventsOutboxBridge(events, outboxService, { finalizeAssistantReply: jest.fn() } as any, config as any);
      bridge.onModuleInit();

      events.publish({
        type: "kanban.runner.error",
        ts: new Date().toISOString(),
        data: {
          projectSlug: "auto-v-arendu",
          taskId: "task-err",
          taskTitle: "Repair deployment smoke test",
          message: "Timed out waiting for OpenCode events"
        }
      });

      const items = readOutboxItems();
      expect(items).toHaveLength(1);
      expect(items[0].text).toBe("⚠️ Kanban runner не смог продолжить задачу \"Repair deployment smoke test\" в проекте auto-v-arendu. Ошибка: Timed out waiting for OpenCode events");
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
