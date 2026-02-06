/**
 * @fileoverview Tests for TelegramOutboxStore leasing and retry logic.
 *
 * Tests:
 * - enqueue/pull leases items and prevents duplicates (L23).
 * - report success marks delivered (L60).
 * - report failure schedules retry with backoff (L86).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { TelegramOutboxStore } from "../telegram-outbox.store";

const TEST_DATA_DIR = path.join(process.cwd(), "data");
const OUTBOX_PATH = path.join(TEST_DATA_DIR, "telegram.outbox.json");

const readFileJson = (): any => JSON.parse(fs.readFileSync(OUTBOX_PATH, "utf-8"));

describe("TelegramOutboxStore", () => {
  beforeEach(() => {
    /* Ensure test isolation; store writes into ./data/telegram.outbox.json. */
    if (fs.existsSync(OUTBOX_PATH)) {
      fs.unlinkSync(OUTBOX_PATH);
    }
  });

  it("leases items on pull and avoids duplicates within lease", () => {
    const store = new TelegramOutboxStore();

    const t0 = Date.parse("2026-02-05T00:00:00.000Z");
    store.enqueue({ adminId: 1, chatId: 10, text: "hello", nowMs: t0 });
    store.enqueue({ adminId: 1, chatId: 10, text: "world", nowMs: t0 });
    const first = store.pull({ adminId: 1, limit: 10, workerId: "w1", nowMs: t0 });
    expect(first.map((i) => i.text)).toEqual(["hello", "world"]);

    const second = store.pull({ adminId: 1, limit: 10, workerId: "w1", nowMs: t0 + 1000 });
    expect(second).toEqual([]);

    const json = readFileJson();
    expect(json.items.length).toBe(2);
    expect(json.items[0].inFlightBy).toBe("w1");
  });

  it("marks delivered on success report", () => {
    const store = new TelegramOutboxStore();
    const t0 = Date.parse("2026-02-05T00:00:00.000Z");
    const item = store.enqueue({ adminId: 2, chatId: 20, text: "ok", nowMs: t0 });
    store.pull({ adminId: 2, limit: 1, workerId: "w2", nowMs: t0 });

    store.report({
      adminId: 2,
      workerId: "w2",
      nowMs: t0,
      results: [{ id: item.id, ok: true, telegramMessageId: 123 }]
    });

    const json = readFileJson();
    const stored = json.items.find((i: any) => i.id === item.id);
    expect(stored.status).toBe("delivered");
    expect(stored.telegramMessageId).toBe(123);
  });

  it("schedules retry on failure report", () => {
    const store = new TelegramOutboxStore();
    const t0 = Date.parse("2026-02-05T00:00:00.000Z");
    const item = store.enqueue({ adminId: 3, chatId: 30, text: "fail", nowMs: t0 });
    store.pull({ adminId: 3, limit: 1, workerId: "w3", nowMs: t0 });

    store.report({
      adminId: 3,
      workerId: "w3",
      nowMs: t0,
      results: [{ id: item.id, ok: false, error: "net" }]
    });

    const json = readFileJson();
    const stored = json.items.find((i: any) => i.id === item.id);
    expect(stored.status).toBe("pending");
    expect(stored.attempts).toBe(1);
    expect(Date.parse(stored.nextAttemptAt)).toBeGreaterThan(t0);
  });
});
