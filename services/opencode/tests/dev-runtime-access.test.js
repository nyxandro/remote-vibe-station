/**
 * @fileoverview Tests for OpenCode dev-runtime host access configuration.
 *
 * Exports:
 * - none (node:test suite verifying Dockerfile and compose templates expose required host tools).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

const readRepoFile = (relativePath) => {
  /* Keep file assertions deterministic across local and CI execution. */
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
};

test("opencode Dockerfile installs git docker and ssh tooling", () => {
  /* Dev operator container must include the CLIs that the agent is expected to execute directly. */
  const dockerfile = readRepoFile("services/opencode/Dockerfile");

  assert.match(dockerfile, /git/);
  assert.match(dockerfile, /docker\.io|docker-cli/);
  assert.match(dockerfile, /docker-compose-plugin|docker-cli-compose|docker-compose/);
  assert.match(dockerfile, /openssh-client/);
  assert.match(dockerfile, /docker-wrapper\.sh/);
});

test("main compose grants opencode direct host access mounts", () => {
  /* Dev-only server operations require docker socket, root SSH keys, and host filesystem visibility. */
  const compose = readRepoFile("docker-compose.yml");

  assert.match(compose, /working_dir: \$\{PROJECTS_ROOT:\?PROJECTS_ROOT must be set\}/);
  assert.match(compose, /- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(compose, /- \/root\/.ssh:\/root\/.ssh/);
  assert.match(compose, /- \/:\/hostfs/);
});

test("runtime template keeps opencode host access mounts", () => {
  /* Production-like runtime installs must preserve the same operator capabilities after image rollout. */
  const compose = readRepoFile("scripts/templates/runtime-docker-compose.yml");

  assert.match(compose, /working_dir: \$\{PROJECTS_ROOT:\?PROJECTS_ROOT must be set\}/);
  assert.match(compose, /- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(compose, /- \/root\/.ssh:\/root\/.ssh/);
  assert.match(compose, /- \/:\/hostfs/);
});

test("dev compose keeps opencode host access mounts", () => {
  /* Local dev stack should mirror server-side operator permissions for reproducible agent behavior. */
  const compose = readRepoFile("docker-compose.dev.yml");

  assert.match(compose, /working_dir: \$\{PROJECTS_ROOT:-\/srv\/projects\}/);
  assert.match(compose, /- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(compose, /- \/root\/.ssh:\/root\/.ssh/);
  assert.match(compose, /- \/:\/hostfs/);
});
