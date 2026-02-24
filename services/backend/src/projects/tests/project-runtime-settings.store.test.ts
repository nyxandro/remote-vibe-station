/**
 * @fileoverview Tests for ProjectRuntimeSettingsStore persistence guarantees.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProjectRuntimeSettingsStore } from "../project-runtime-settings.store";

describe("ProjectRuntimeSettingsStore", () => {
  let tempRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    /* Isolate cwd because store path is relative to process.cwd(). */
    originalCwd = process.cwd();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-store-"));
    process.chdir(tempRoot);
  });

  afterEach(() => {
    /* Restore cwd and cleanup temporary state. */
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("throws explicit error when settings file has invalid JSON", async () => {
    /* Parse failures must fail fast to avoid accidental data overwrite on next save. */
    const filePath = path.join(tempRoot, "data", "project-runtime.settings.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{broken json", "utf-8");

    const store = new ProjectRuntimeSettingsStore();

    await expect(store.get("demo")).rejects.toThrow("Failed to parse runtime settings JSON");
  });

  test("serializes concurrent set calls without dropping entries", async () => {
    /* Parallel writes should keep both project records via internal queue lock. */
    const store = new ProjectRuntimeSettingsStore();

    await Promise.all([
      store.set("alpha", { mode: "docker", serviceName: "web", internalPort: 8080, staticRoot: null }),
      store.set("beta", { mode: "static", serviceName: null, internalPort: null, staticRoot: "public" })
    ]);

    await expect(store.get("alpha")).resolves.toEqual({
      mode: "docker",
      serviceName: "web",
      internalPort: 8080,
      staticRoot: null
    });
    await expect(store.get("beta")).resolves.toEqual({
      mode: "static",
      serviceName: null,
      internalPort: null,
      staticRoot: "public"
    });
  });
});
