/**
 * @fileoverview Tests for Telegram notification about newly auto-started OpenCode sessions.
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

describe("Telegram session started notification", () => {
  test("routes opencode.session.started into admin notification", () => {
    /* Auto-created sessions must be visible in Telegram even when stream mode is disabled. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-session-started-"));
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
      const bridge = new TelegramEventsOutboxBridge(events, outboxService, {
        finalizeAssistantReply: jest.fn()
      } as any, config as any);
      bridge.onModuleInit();

      events.publish({
        type: "opencode.session.started",
        ts: new Date().toISOString(),
        data: {
          adminId: 1,
          projectSlug: "carousel",
          trigger: "busy-rotated"
        }
      });

      const items = readOutboxItems();
      expect(items).toHaveLength(1);
      expect(items[0].chatId).toBe(123);
      expect(items[0].text).toBe("🆕 Начата новая сессия (проект: carousel).");
      expect(items[0].disableNotification).toBe(true);
    } finally {
      process.chdir(prev);
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  test("routes project.selected into admin notification after legacy stream-off state", () => {
    /* Project selection is routing-critical, so it must not depend on the removed stream toggle. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-project-selected-"));
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

      const outboxService = new TelegramOutboxService(streamStore, new TelegramOutboxStore());
      const events = new EventsService(config as any);
      const bridge = new TelegramEventsOutboxBridge(events, outboxService, {
        finalizeAssistantReply: jest.fn()
      } as any, config as any);
      bridge.onModuleInit();

      events.publish({
        type: "project.selected",
        ts: new Date().toISOString(),
        data: {
          adminId: 1,
          slug: "demo",
          name: "Demo",
          rootPath: "/srv/projects/demo"
        }
      });

      const items = readOutboxItems();
      expect(items).toHaveLength(1);
      expect(items[0].chatId).toBe(123);
      expect(items[0].text).toBe("📁 Выбран проект: Demo\n/srv/projects/demo");
      expect(items[0].disableNotification).toBe(true);
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
