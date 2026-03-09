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
  test("sends assistant commentary as a fresh Telegram message without progress replace", () => {
    /* Commentary between tools must create a new chat message instead of editing the previous one. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-outbox-service-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 123);
      streamStore.setStreamEnabled(1, true);

      const service = new TelegramOutboxService(streamStore, new TelegramOutboxStore());
      service.enqueueAssistantCommentary({ adminId: 1, text: "**Готово**\n\nПроверил конфиг." });

      const assistantItems = readItems().filter((item) => item.control == null);
      expect(assistantItems).toHaveLength(1);
      expect(assistantItems[0].mode).toBeUndefined();
      expect(assistantItems[0].progressKey).toBeUndefined();
      expect(assistantItems[0].parseMode).toBe("HTML");
      expect(assistantItems[0].text).toContain("Готово");
      expect(assistantItems[0].text).toContain("Проверил конфиг.");
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

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
      expect(assistantItems[0].text).toContain("<blockquote>");
      expect(assistantItems[0].text).toContain("cliproxy/gpt-5.4");
      expect(assistantItems[0].text).toContain("| build");
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("reuses the latest commentary bubble when final reply text is identical", () => {
    /* Runtime may flush the final text block before the summary footer arrives, so the footer must update that same bubble. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-outbox-service-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 123);
      streamStore.setStreamEnabled(1, true);

      const service = new TelegramOutboxService(streamStore, new TelegramOutboxStore());
      service.enqueueAssistantCommentary({
        adminId: 1,
        sessionId: "session-1",
        text: "OK"
      });

      service.enqueueAssistantReply({
        adminId: 1,
        delivery: {
          sessionId: "session-1",
          text: "OK",
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          thinking: "medium",
          agent: "build",
          tokens: { input: 1, output: 2, reasoning: 0 }
        }
      });

      const assistantItems = readItems().filter((item) => item.control == null);
      expect(assistantItems).toHaveLength(1);
      expect(assistantItems[0].mode).toBe("replace");
      expect(assistantItems[0].progressKey).toBe("assistant-commentary:1:session-1:1");
      expect(assistantItems[0].text).toContain("OK");
      expect(assistantItems[0].text).toContain("<blockquote>");
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("starts a fresh streamed message after a blocking question pause", () => {
    /* Question/permission pauses must close the old assistant stream slot so the resumed answer does not rewrite history. */
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
        text: "Первый фрагмент"
      });
      service.closeAssistantProgress({ sessionId: "session-1" });
      service.enqueueAssistantStreamDelta({
        adminId: 1,
        sessionId: "session-1",
        text: "Новый ответ после вопроса"
      });

      const assistantItems = readItems().filter((item) => item.control == null);
      expect(assistantItems).toHaveLength(2);
      expect(assistantItems[0].progressKey).toBe("assistant:1:session-1:1");
      expect(assistantItems[1].progressKey).toBe("assistant:1:session-1:2");
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("adds footer block even when final chunk renderer receives body without quote line", () => {
    /* Final message metadata should remain visible even if only the body chunk survives into rendering. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-outbox-service-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 123);
      streamStore.setStreamEnabled(1, false);

      const service = new TelegramOutboxService(streamStore, new TelegramOutboxStore());
      const ensured = (service as any).ensureRenderedFooter({
        html: "Финальный ответ",
        isFinalChunk: true,
        footerHtml: "<blockquote>10 | 1% | cliproxy/gpt-5.4 | medium | build</blockquote>"
      });

      expect(ensured).toContain("Финальный ответ");
      expect(ensured).toContain("<blockquote>10 | 1% | cliproxy/gpt-5.4 | medium | build</blockquote>");
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
