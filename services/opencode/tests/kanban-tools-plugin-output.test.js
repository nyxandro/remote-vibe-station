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

test("kanban plugin source includes per-criterion ids and statuses in task details", () => {
  /* Agents need stable criterion ids plus visible states so they can update checklist progress deterministically. */
  assert.match(pluginSource, /criterion\.id/);
  assert.match(pluginSource, /humanizeCriterionStatus/);
});

test("kanban plugin source exposes an explicit criterion update tool", () => {
  /* Progress automation depends on a dedicated tool instead of overloading generic task refinement calls. */
  assert.match(pluginSource, /kanban_update_criterion/);
});

test("kanban plugin source prefers backend message text for failed tool calls", () => {
  /* Human-readable backend validation messages should survive plugin transport without raw JSON noise. */
  assert.match(pluginSource, /payload\.message/);
  assert.match(pluginSource, /Kanban backend request failed with status \$\{response\.status\}: \$\{message\}/);
});

test("kanban plugin source forwards OpenCode sessionID on execution mutations", () => {
  /* Backend ownership checks depend on the real OpenCode session id for every task mutation. */
  assert.match(pluginSource, /sessionId: context\.sessionID/);
});

test("kanban plugin source soft-handles execution ownership conflicts", () => {
  /* When another session already owns a task, the current session should stop cleanly instead of crashing red. */
  assert.match(pluginSource, /KANBAN_EXECUTION_OWNERSHIP_CONFLICT/);
  assert.match(pluginSource, /Task execution already belongs to another OpenCode session/);
});

test("kanban plugin source exposes refinement and ready workflow stages", () => {
  /* Agents should see the new planning columns and move tasks through them before queueing execution. */
  assert.match(pluginSource, /"refinement"/);
  assert.match(pluginSource, /"ready"/);
});
