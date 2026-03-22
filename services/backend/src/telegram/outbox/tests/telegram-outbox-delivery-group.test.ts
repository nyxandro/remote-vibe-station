/**
 * @fileoverview Tests for assistant final-reply delivery grouping.
 *
 * Exports:
 * - none (Jest suite).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TelegramStreamStore } from "../../telegram-stream.store";
import { TelegramOutboxService } from "../telegram-outbox.service";
import { TelegramOutboxStore } from "../telegram-outbox.store";

const readItems = (): any[] => {
  const outboxPath = path.join(process.cwd(), "data", "telegram.outbox.json");
  if (!fs.existsSync(outboxPath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(outboxPath, "utf-8")).items ?? [];
};

describe("TelegramOutboxService delivery groups", () => {
  test("assigns one deliveryGroupId to all chunks of a final assistant reply", () => {
    /* Handoff barrier must be able to wait for the full final answer, not just the first Telegram chunk. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-outbox-group-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 123);
      streamStore.setStreamEnabled(1, false);

      const service = new TelegramOutboxService(streamStore, new TelegramOutboxStore());
      const result = service.enqueueAssistantReply({
        adminId: 1,
        delivery: {
          sessionId: "session-1",
          text: "x".repeat(5_000),
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          thinking: null,
          agent: "build",
          tokens: { input: 1, output: 2, reasoning: 0 }
        }
      });

      const assistantItems = readItems().filter((item) => item.control == null);
      expect(assistantItems.length).toBeGreaterThan(1);
      expect(result.deliveryGroupId).toBeTruthy();
      expect(new Set(assistantItems.map((item) => item.deliveryGroupId))).toEqual(new Set([result.deliveryGroupId]));
      expect(result.itemIds).toHaveLength(assistantItems.length);
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
