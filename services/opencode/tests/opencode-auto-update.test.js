/**
 * @fileoverview Tests for OpenCode runtime auto-update bootstrap logic.
 *
 * Exports:
 * - none (node:test suite validating TTL cache and force update behavior).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ensureOpenCodeAutoUpdate } = require("../opencode-auto-update.js");

test("ensureOpenCodeAutoUpdate updates toolbox install when npm latest is newer", async () => {
  /* Startup should self-heal stale runtimes without requiring a new image build for every OpenCode release. */
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-opencode-update-"));

  try {
    let installedVersion = "1.2.3";
    const commands = [];
    const result = await ensureOpenCodeAutoUpdate({
      cachePath: path.join(tempRoot, "cache.json"),
      force: false,
      nowMs: Date.parse("2026-04-13T20:00:00.000Z"),
      ttlHours: 12,
      runCommand: async (command, args) => {
        commands.push([command, ...args]);

        if (command === "opencode") {
          return `${installedVersion}\n`;
        }
        if (command === "npm" && args[0] === "view") {
          return '"1.2.4"\n';
        }
        if (command === "npm" && args[0] === "install") {
          installedVersion = "1.2.4";
          return "installed\n";
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
    });

    assert.equal(result.updated, true);
    assert.equal(result.currentVersion, "1.2.4");
    assert.equal(result.latestVersion, "1.2.4");
    assert.deepEqual(commands, [
      ["opencode", "--version"],
      ["npm", "view", "opencode-ai", "version", "--json"],
      ["npm", "install", "-g", "opencode-ai@1.2.4"],
      ["opencode", "--version"]
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("ensureOpenCodeAutoUpdate uses cached latest version inside TTL window", async () => {
  /* Routine restarts should stay fast and avoid hitting npm when the version check cache is still fresh. */
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-opencode-cache-"));

  try {
    const cachePath = path.join(tempRoot, "cache.json");
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ latestVersion: "1.2.4", checkedAt: "2026-04-13T19:30:00.000Z" }) + "\n",
      "utf8"
    );

    const commands = [];
    const result = await ensureOpenCodeAutoUpdate({
      cachePath,
      nowMs: Date.parse("2026-04-13T20:00:00.000Z"),
      ttlHours: 12,
      runCommand: async (command, args) => {
        commands.push([command, ...args]);

        if (command === "opencode") {
          return "1.2.4\n";
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
    });

    assert.equal(result.updated, false);
    assert.equal(result.source, "cache");
    assert.deepEqual(commands, [["opencode", "--version"]]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("ensureOpenCodeAutoUpdate bypasses TTL cache on force update", async () => {
  /* Manual Update OpenCode action must hit npm immediately even when a cached latest value exists. */
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-opencode-force-"));

  try {
    const cachePath = path.join(tempRoot, "cache.json");
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ latestVersion: "1.2.4", checkedAt: "2026-04-13T19:30:00.000Z" }) + "\n",
      "utf8"
    );

    let installedVersion = "1.2.4";
    const commands = [];
    const result = await ensureOpenCodeAutoUpdate({
      cachePath,
      force: true,
      nowMs: Date.parse("2026-04-13T20:00:00.000Z"),
      ttlHours: 12,
      runCommand: async (command, args) => {
        commands.push([command, ...args]);

        if (command === "opencode") {
          return `${installedVersion}\n`;
        }
        if (command === "npm" && args[0] === "view") {
          return '"1.2.5"\n';
        }
        if (command === "npm" && args[0] === "install") {
          installedVersion = "1.2.5";
          return "installed\n";
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
    });

    assert.equal(result.updated, true);
    assert.equal(result.currentVersion, "1.2.5");
    assert.equal(result.source, "registry");
    assert.equal(commands[1][0], "npm");
    assert.equal(commands[1][1], "view");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
