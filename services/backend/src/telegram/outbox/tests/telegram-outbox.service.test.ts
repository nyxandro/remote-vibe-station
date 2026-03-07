/**
 * @fileoverview Tests for TelegramOutboxService assistant stream progress keys.
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

describe("TelegramOutboxService", () => {
  test("reuses explicit stream progress key for final assistant reply", () => {
    /* Final answer must replace the latest streamed part message instead of reopening an older session-wide one. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-outbox-service-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 123);
      streamStore.setStreamEnabled(1, true);

      const service = new TelegramOutboxService(streamStore, new TelegramOutboxStore());

      service.enqueueAssistantStreamDelta({
        adminId: 1,
        sessionId: "session-1",
        progressKey: "assistant:1:session-1:assistant-part-2",
        text: "Промежуточный текст"
      });

      service.enqueueAssistantReply({
        adminId: 1,
        delivery: {
          sessionId: "session-1",
          text: "Финальный ответ",
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          thinking: null,
          agent: "build",
          tokens: { input: 1, output: 2, reasoning: 0 }
        }
      });

      const assistantItems = readItems().filter((item) => item.control == null);
      expect(assistantItems).toHaveLength(1);
      expect(assistantItems[0].progressKey).toBe("assistant:1:session-1:assistant-part-2");
      expect(assistantItems[0].mode).toBe("replace");
      expect(assistantItems[0].text).toContain("Финальный ответ");
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
