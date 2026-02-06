/**
 * @fileoverview Tests for TelegramStreamStore.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TelegramStreamStore } from "../telegram-stream.store";

describe("TelegramStreamStore", () => {
  test("binds chat and toggles stream", () => {
    /* Use isolated cwd so store writes into a temp folder. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-tg-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const store = new TelegramStreamStore();

      expect(store.get(123)).toBeNull();

      const bound = store.bindAdminChat(123, 777);
      expect(bound.chatId).toBe(777);
      expect(bound.streamEnabled).toBe(false);

      const enabled = store.setStreamEnabled(123, true);
      expect(enabled.streamEnabled).toBe(true);

      const disabled = store.setStreamEnabled(123, false);
      expect(disabled.streamEnabled).toBe(false);
    } finally {
      process.chdir(prev);
    }
  });
});
