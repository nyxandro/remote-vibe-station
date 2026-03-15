/**
 * @fileoverview Source-level tests for Telegram media OpenCode plugin contract.
 *
 * Exports:
 * - none (node:test assertions against the plugin source file).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pluginSource = fs.readFileSync(path.join(__dirname, "..", "telegram-media-tools-plugin.ts"), "utf8");

test("telegram media plugin exposes single-file and album tools", () => {
  /* Agents need explicit tools for one file and one multi-photo Telegram album. */
  assert.match(pluginSource, /telegram_send_media/);
  assert.match(pluginSource, /telegram_send_album/);
});

test("telegram media plugin stages files into the shared outgoing directory", () => {
  /* Tool output must converge on one managed directory so backend cleanup stays bounded. */
  assert.match(pluginSource, /agent-share/);
  assert.match(pluginSource, /outgoing/);
  assert.match(pluginSource, /fs\.copyFileSync/);
});

test("telegram media plugin documents photo vs document delivery semantics", () => {
  /* Agents must know that document mode preserves original bytes while photo mode may compress. */
  assert.match(pluginSource, /sendAs='photo'/);
  assert.match(pluginSource, /sendAs='document'/);
  assert.match(pluginSource, /without Telegram image compression/);
});

test("telegram media plugin binds delivery to the current session context", () => {
  /* Media must return only to the Telegram chat already bound to the active OpenCode session. */
  assert.match(pluginSource, /current OpenCode session/);
  assert.match(pluginSource, /sessionId: context\.sessionID/);
  assert.doesNotMatch(pluginSource, /adminId: tool\.schema/);
});
