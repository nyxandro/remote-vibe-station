/**
 * @fileoverview Tests for syncing default kanban OpenCode plugin assets into the config volume.
 *
 * Exports:
 * - none (node:test suite).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ensureKanbanPluginAssets } = require("../kanban-plugin-sync.js");

test("ensureKanbanPluginAssets copies plugin file and merges required package dependency", () => {
  /* Shared OpenCode config should receive the kanban plugin without overwriting unrelated dependencies. */
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-kanban-plugin-"));

  try {
    const configDir = path.join(tempRoot, "config");
    const pluginSourcePath = path.join(tempRoot, "kanban-tools-plugin.ts");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(pluginSourcePath, "export const Demo = 1;\n", "utf8");
    fs.writeFileSync(
      path.join(configDir, "package.json"),
      JSON.stringify({ dependencies: { zod: "^3.0.0" } }, null, 2),
      "utf8"
    );

    const result = ensureKanbanPluginAssets({ configDir, pluginSourcePath });
    const copiedPlugin = fs.readFileSync(result.targetPluginPath, "utf8");
    const packageJson = JSON.parse(fs.readFileSync(result.packageJsonPath, "utf8"));

    assert.equal(copiedPlugin, "export const Demo = 1;\n");
    assert.equal(packageJson.dependencies.zod, "^3.0.0");
    assert.equal(packageJson.dependencies["@opencode-ai/plugin"], "latest");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
