/**
 * @fileoverview Tests for generic JSON file helpers used by backend stores.
 *
 * Exports:
 * - none (Jest test suite).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  readJsonFileAsync,
  readJsonFileSync,
  writeJsonFileAsyncAtomic,
  writeJsonFileSyncAtomic
} from "../json-file";

describe("json-file helpers", () => {
  let tempRoot: string;

  beforeEach(() => {
    /* Keep helper tests isolated from the real backend data directory. */
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-json-file-"));
  });

  afterEach(() => {
    /* Remove temporary files even when a test intentionally creates corrupt backups. */
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("sync read moves malformed JSON aside and returns empty fallback", () => {
    /* Recoverable stores must survive partial writes instead of crashing the backend. */
    const filePath = path.join(tempRoot, "data", "sample.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{broken-json", "utf-8");
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const value = readJsonFileSync({
        filePath,
        label: "sample-store",
        createEmptyValue: () => ({ items: [] as string[] }),
        normalize: (parsed) => parsed as { items: string[] },
        parseErrorStrategy: "recover",
        normalizeErrorStrategy: "recover"
      });

      const backups = fs
        .readdirSync(path.dirname(filePath))
        .filter((name) => name.startsWith("sample.json.corrupt-"));

      expect(value).toEqual({ items: [] });
      expect(backups).toHaveLength(1);
      expect(fs.existsSync(filePath)).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("sync read does not back up file when only normalization fails", () => {
    /* Older schemas should not be treated as raw file corruption when JSON itself is valid. */
    const filePath = path.join(tempRoot, "data", "shape.json");
    writeJsonFileSyncAtomic(filePath, { unexpected: true });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const value = readJsonFileSync({
        filePath,
        label: "shape-store",
        createEmptyValue: () => ({ ok: false }),
        normalize: () => {
          throw new Error("schema mismatch");
        },
        parseErrorStrategy: "recover",
        normalizeErrorStrategy: "recover"
      });

      const backups = fs
        .readdirSync(path.dirname(filePath))
        .filter((name) => name.startsWith("shape.json.corrupt-"));

      expect(value).toEqual({ ok: false });
      expect(backups).toHaveLength(0);
      expect(fs.existsSync(filePath)).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("async read throws contextual error for strict stores", async () => {
    /* Business-critical stores must fail fast on broken JSON instead of silently resetting state. */
    const filePath = path.join(tempRoot, "data", "strict.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{broken-json", "utf-8");

    await expect(
      readJsonFileAsync({
        filePath,
        label: "strict store",
        createEmptyValue: () => ({ items: [] as string[] }),
        normalize: (parsed) => parsed as { items: string[] },
        parseErrorStrategy: "throw",
        normalizeErrorStrategy: "throw"
      })
    ).rejects.toThrow("Failed to parse strict store JSON");
  });

  test("async atomic write creates parent directory and persists readable JSON", async () => {
    /* All stores should share the same temp-file rename semantics for crash-safe writes. */
    const filePath = path.join(tempRoot, "nested", "state.json");

    await writeJsonFileAsyncAtomic(filePath, {
      mode: "direct",
      updatedAt: "2026-03-11T10:00:00.000Z"
    });

    expect(JSON.parse(fs.readFileSync(filePath, "utf-8"))).toEqual({
      mode: "direct",
      updatedAt: "2026-03-11T10:00:00.000Z"
    });
  });
});
