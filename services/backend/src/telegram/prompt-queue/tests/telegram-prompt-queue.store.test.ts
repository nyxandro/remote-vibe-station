/**
 * @fileoverview Tests for TelegramPromptQueueStore persistence recovery.
 *
 * Exports:
 * - none (Jest test suite).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { TelegramPromptQueueStore } from "../telegram-prompt-queue.store";

const TEST_DATA_DIR = path.join(process.cwd(), "data");
const QUEUE_PATH = path.join(TEST_DATA_DIR, "telegram.prompt-queue.json");

describe("TelegramPromptQueueStore", () => {
  beforeEach(() => {
    /* Keep recovery tests isolated from any previously persisted queue state. */
    fs.rmSync(QUEUE_PATH, { force: true });
  });

  afterEach(() => {
    /* Cleanup only the primary queue file; backup artifacts are removed explicitly in tests. */
    fs.rmSync(QUEUE_PATH, { force: true });
  });

  it("backs up corrupted JSON and continues with an empty queue", () => {
    /* Broken persisted state must not block the Telegram-to-OpenCode relay after restart. */
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    fs.writeFileSync(QUEUE_PATH, "{broken-json", "utf-8");
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const store = new TelegramPromptQueueStore();

      expect(store.listBuffers()).toEqual([]);
      expect(store.countOutstandingItems("admin:/demo")).toBe(0);

      const backups = fs
        .readdirSync(TEST_DATA_DIR)
        .filter((name) => name.startsWith("telegram.prompt-queue.json.corrupt-"));

      expect(backups).toHaveLength(1);
      expect(fs.existsSync(QUEUE_PATH)).toBe(false);

      fs.rmSync(path.join(TEST_DATA_DIR, backups[0]), { force: true });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
