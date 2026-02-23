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
});
