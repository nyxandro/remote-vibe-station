/**
 * @fileoverview Tests for persisting active project selection.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ActiveProjectStore } from "../active-project.store";

describe("ActiveProjectStore", () => {
  test("persists and restores slug", () => {
    /* Use isolated cwd so store writes into a temp folder. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-active-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const store = new ActiveProjectStore();
      expect(store.get()).toBeNull();

      store.set("demo");
      expect(store.get()).toBe("demo");

      store.set(null);
      expect(store.get()).toBeNull();
    } finally {
      process.chdir(prev);
    }
  });
});
