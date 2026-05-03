/**
 * @fileoverview Tests for TelegramStreamStore.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TelegramStreamStore } from "../telegram-stream.store";

describe("TelegramStreamStore", () => {
  test("binds chat and keeps stream always enabled", () => {
    /* Use isolated cwd so store writes into a temp folder while verifying legacy off writes normalize to enabled. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-tg-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const store = new TelegramStreamStore();

      expect(store.get(123)).toBeNull();

      const bound = store.bindAdminChat(123, 777);
      expect(bound.chatId).toBe(777);
      expect(bound.streamEnabled).toBe(true);

      const enabled = store.setStreamEnabled(123, true);
      expect(enabled.streamEnabled).toBe(true);

      const disabled = store.setStreamEnabled(123, false);
      expect(disabled.streamEnabled).toBe(true);
      expect(store.get(123)?.streamEnabled).toBe(true);
    } finally {
      process.chdir(prev);
    }
  });

  test("recovers from corrupted JSON by moving it aside", () => {
    /* Telegram chat binding state should survive malformed file recovery on restart. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-tg-"));
    const prev = process.cwd();
    process.chdir(tmp);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const filePath = path.join(tmp, "data", "telegram.stream.json");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "{broken-json", "utf-8");

      const store = new TelegramStreamStore();

      expect(store.get(123)).toBeNull();
      const backups = fs.readdirSync(path.join(tmp, "data")).filter((name) => name.startsWith("telegram.stream.json.corrupt-"));
      expect(backups).toHaveLength(1);
      expect(fs.existsSync(filePath)).toBe(false);
    } finally {
      errorSpy.mockRestore();
      process.chdir(prev);
    }
  });
});
