/**
 * @fileoverview Regression tests for stable task id visibility in kanban tool outputs.
 *
 * Exports:
 * - none (node:test suite).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pluginSource = fs.readFileSync(
  path.join(__dirname, "..", "kanban-tools-plugin.ts"),
  "utf8"
);

test("kanban plugin source includes explicit taskId in task details", () => {
  /* Agents must see the same stable id after create/claim/refine/complete instead of inferring it indirectly. */
  assert.match(pluginSource, /taskId: \$\{task\.id\}/);
});

test("kanban plugin source includes explicit taskId in task list lines", () => {
  /* List output must surface ids so agents can safely refine or complete backlog items selected from the board. */
  assert.match(pluginSource, /Task ID: \$\{task\.id\}/);
});
