/**
 * @fileoverview Tests for syncing default Telegram media OpenCode plugin assets.
 *
 * Exports:
 * - none (node:test suite validating telegram-media-plugin-sync helper behavior).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ensureTelegramMediaPluginAssets } = require("../telegram-media-plugin-sync.js");

test("ensureTelegramMediaPluginAssets copies plugin source and merges dependency", () => {
  /* Shared OpenCode config should receive the Telegram media plugin without clobbering existing dependencies. */
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-telegram-plugin-"));

  try {
    const configDir = path.join(tempRoot, "config");
    const pluginSourcePath = path.join(tempRoot, "telegram-media-tools-plugin.ts");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(pluginSourcePath, "export const Demo = 1;\n", "utf8");
    fs.writeFileSync(
      path.join(configDir, "package.json"),
      JSON.stringify({ dependencies: { zod: "latest" } }, null, 2) + "\n",
      "utf8"
    );

    const result = ensureTelegramMediaPluginAssets({ configDir, pluginSourcePath });
    const copied = fs.readFileSync(result.targetPluginPath, "utf8");
    const packageJson = JSON.parse(fs.readFileSync(result.packageJsonPath, "utf8"));

    assert.equal(copied, "export const Demo = 1;\n");
    assert.equal(packageJson.dependencies["@opencode-ai/plugin"], "latest");
    assert.equal(packageJson.dependencies.zod, "latest");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
