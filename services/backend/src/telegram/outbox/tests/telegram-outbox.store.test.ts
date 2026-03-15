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

  it("pull preserves media payloads for photo/document delivery", () => {
    /* Bot worker must receive the staged file payload exactly as backend enqueued it. */
    const store = new TelegramOutboxStore();
    const t0 = Date.parse("2026-02-05T00:00:00.000Z");

    store.enqueue({
      adminId: 4,
      chatId: 40,
      text: "caption",
      kind: "media",
      media: {
        kind: "document",
        filePath: "/tmp/report.pdf",
        fileName: "report.pdf",
        caption: "Смотри"
      },
      nowMs: t0
    });

    const pulled = store.pull({ adminId: 4, limit: 1, workerId: "w4", nowMs: t0 });

    expect(pulled).toHaveLength(1);
    expect(pulled[0]).toMatchObject({
      kind: "media",
      media: {
        kind: "document",
        filePath: "/tmp/report.pdf",
        fileName: "report.pdf",
        caption: "Смотри"
      }
    });
  });

  it("coalesces pending replace updates by progressKey", () => {
    /* Live Telegram stream edits must keep one freshest pending snapshot per progress message. */
    const store = new TelegramOutboxStore();
    const t0 = Date.parse("2026-02-05T00:00:00.000Z");

    const first = store.enqueue({
      adminId: 5,
      chatId: 50,
      text: "one",
      mode: "replace",
      progressKey: "assistant:5:session-1:1",
      nowMs: t0
    });

    const second = store.enqueue({
      adminId: 5,
      chatId: 50,
      text: "two",
      mode: "replace",
      progressKey: "assistant:5:session-1:1",
      nowMs: t0 + 1
    });

    const json = readFileJson();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe(first.id);
    expect(json.items[0].text).toBe("two");
    expect(json.items[0].inFlightBy).toBeUndefined();
    expect(second.id).toBe(first.id);
  });

  it("keeps a fresh pending replace snapshot when previous progress item is already in flight", () => {
    /* Stream updates that arrive after pull must not be overwritten by the first successful report. */
    const store = new TelegramOutboxStore();
    const t0 = Date.parse("2026-02-05T00:00:00.000Z");

    const first = store.enqueue({
      adminId: 6,
      chatId: 60,
      text: "H",
      mode: "replace",
      progressKey: "assistant:6:session-1:1",
      nowMs: t0
    });

    store.pull({ adminId: 6, limit: 1, workerId: "w6", nowMs: t0 });

    const second = store.enqueue({
      adminId: 6,
      chatId: 60,
      text: "Hello, world",
      mode: "replace",
      progressKey: "assistant:6:session-1:1",
      nowMs: t0 + 1
    });

    const json = readFileJson();
    expect(json.items).toHaveLength(2);
    expect(first.id).not.toBe(second.id);
    expect(json.items[0].id).toBe(first.id);
    expect(json.items[0].inFlightBy).toBe("w6");
    expect(json.items[1].id).toBe(second.id);
    expect(json.items[1].text).toBe("Hello, world");
    expect(json.items[1].inFlightBy).toBeUndefined();
  });

  it("deduplicates identical plain messages emitted within a short window", () => {
    /* Fast duplicate event delivery should not create two identical Telegram bubbles in chat history. */
    const store = new TelegramOutboxStore();
    const t0 = Date.parse("2026-02-05T00:00:00.000Z");

    const first = store.enqueue({
      adminId: 7,
      chatId: 70,
      text: "Один и тот же ответ",
      parseMode: "HTML",
      disableNotification: true,
      nowMs: t0
    });
    const second = store.enqueue({
      adminId: 7,
      chatId: 70,
      text: "Один и тот же ответ",
      parseMode: "HTML",
      disableNotification: true,
      nowMs: t0 + 500
    });

    const json = readFileJson();
    expect(json.items).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(json.items[0].text).toBe("Один и тот же ответ");
  });

  it("prunes delivered history and old dead letters", () => {
    /* Prepare a large-ish file directly to test retention without expensive enqueue loops. */
    if (!fs.existsSync(TEST_DATA_DIR)) {
      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    }

    const base = Date.parse("2026-02-05T00:00:00.000Z");
    const delivered = Array.from({ length: 5 }).map((_, idx) => ({
      id: `del-${idx}`,
      adminId: 1,
      chatId: 1,
      text: "x",
      createdAt: new Date(base - 10_000 - idx).toISOString(),
      status: "delivered" as const,
      attempts: 0,
      nextAttemptAt: new Date(base).toISOString(),
      deliveredAt: new Date(base + idx).toISOString()
    }));

    const deadOld = {
      id: "dead-old",
      adminId: 1,
      chatId: 1,
      text: "x",
      createdAt: new Date(base - 100_000).toISOString(),
      status: "dead" as const,
      attempts: 99,
      nextAttemptAt: new Date(base).toISOString(),
      deadAt: new Date(base - 86_400_000 * 40).toISOString()
    };

    const deadNew = {
      id: "dead-new",
      adminId: 1,
      chatId: 1,
      text: "x",
      createdAt: new Date(base - 100_000).toISOString(),
      status: "dead" as const,
      attempts: 99,
      nextAttemptAt: new Date(base).toISOString(),
      deadAt: new Date(base - 1000).toISOString()
    };

    fs.writeFileSync(OUTBOX_PATH, JSON.stringify({ items: [...delivered, deadOld, deadNew] }, null, 2), "utf-8");

    const store = new TelegramOutboxStore();
    store.prune({
      maxDeliveredToKeep: 2,
      maxDeadToKeep: 10,
      maxDeadAgeMs: 86_400_000,
      nowMs: base
    });

    const json = readFileJson();
    const deliveredLeft = json.items.filter((i: any) => i.status === "delivered");
    const deadLeft = json.items.filter((i: any) => i.status === "dead");

    /* Delivered items are capped to 2 newest. */
    expect(deliveredLeft).toHaveLength(2);
    expect(deliveredLeft.map((i: any) => i.id)).toEqual(["del-3", "del-4"]);

    /* Old dead letters are dropped by age, recent ones remain. */
    expect(deadLeft.map((i: any) => i.id)).toEqual(["dead-new"]);
  });

  it("backs up corrupted JSON and accepts new messages again", () => {
    /* Corrupted outbox file must not crash delivery recovery on the next backend write. */
    fs.writeFileSync(OUTBOX_PATH, "{broken-json", "utf-8");
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const store = new TelegramOutboxStore();
      const item = store.enqueue({ adminId: 8, chatId: 80, text: "после восстановления" });

      const backups = fs
        .readdirSync(TEST_DATA_DIR)
        .filter((name) => name.startsWith("telegram.outbox.json.corrupt-"));

      expect(backups).toHaveLength(1);

      const json = readFileJson();
      expect(json.items).toHaveLength(1);
      expect(json.items[0].id).toBe(item.id);
      expect(json.items[0].text).toBe("после восстановления");

      fs.rmSync(path.join(TEST_DATA_DIR, backups[0]), { force: true });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
