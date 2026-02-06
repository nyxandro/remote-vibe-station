/**
 * @fileoverview Tests for diff preview token storage.
 *
 * Exports:
 * - (none)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TelegramDiffPreviewStore } from "../telegram-diff-preview.store";

describe("TelegramDiffPreviewStore", () => {
  let tmpRoot = "";
  let previousCwd = "";

  beforeEach(() => {
    /* Isolate persistent store file in temporary directory. */
    previousCwd = process.cwd();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tg-diff-preview-"));
    process.chdir(tmpRoot);
  });

  afterEach(() => {
    /* Cleanup temp directory and restore process cwd. */
    process.chdir(previousCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("creates and resolves preview records by token", () => {
    const store = new TelegramDiffPreviewStore();
    const created = store.create({
      adminId: 123,
      operation: "edit",
      absolutePath: "/tmp/demo.ts",
      additions: 5,
      deletions: 2,
      diff: "@@ -1 +1 @@",
      before: "old",
      after: "new"
    });

    const found = store.get(created.token);
    expect(found?.adminId).toBe(123);
    expect(found?.absolutePath).toBe("/tmp/demo.ts");
    expect(found?.additions).toBe(5);
  });
});
