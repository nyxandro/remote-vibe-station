/**
 * @fileoverview Tests for Telegram preferences store persistence.
 *
 * Exports:
 * - (none)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TelegramPreferencesStore } from "../telegram-preferences.store";

describe("TelegramPreferencesStore", () => {
  let tmpRoot = "";
  let prevCwd = "";

  beforeEach(() => {
    /* Isolate filesystem state for each test case. */
    prevCwd = process.cwd();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tg-pref-store-"));
    process.chdir(tmpRoot);
  });

  afterEach(() => {
    /* Always restore cwd and remove temp files. */
    process.chdir(prevCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns empty preferences when file does not exist", () => {
    const store = new TelegramPreferencesStore();

    expect(store.get(123)).toEqual({});
  });

  it("persists and reloads admin preferences", () => {
    const store = new TelegramPreferencesStore();
    store.set(123, {
      model: { providerID: "opencode", modelID: "big-pickle" },
      thinking: "high",
      agent: "build"
    });

    const reloaded = new TelegramPreferencesStore();
    expect(reloaded.get(123)).toEqual({
      model: { providerID: "opencode", modelID: "big-pickle" },
      thinking: "high",
      agent: "build"
    });
  });
});
