/**
 * @fileoverview Tests for OpenCode and backend runtime host-access configuration.
 *
 * Exports:
 * - none (node:test suite verifying Dockerfiles and compose templates expose required git auth tooling).
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

test("opencode Dockerfile installs git docker ssh and gh tooling", () => {
  /* Operator container must support both SSH and GitHub CLI auth flows without extra manual setup. */
  const dockerfile = readRepoFile("services/opencode/Dockerfile");

  assert.match(dockerfile, /git/);
  assert.match(dockerfile, /\bgh\b/);
  assert.match(dockerfile, /docker\.io|docker-cli/);
  assert.match(dockerfile, /docker-compose-plugin|docker-cli-compose|docker-compose/);
  assert.match(dockerfile, /openssh-client/);
  assert.match(dockerfile, /docker-wrapper\.sh/);
});

test("backend Dockerfile installs git ssh and gh tooling", () => {
  /* Backend clone and git-ops endpoints execute git directly, so they need the same auth binaries. */
  const dockerfile = readRepoFile("services/backend/Dockerfile");

  assert.match(dockerfile, /git/);
  assert.match(dockerfile, /openssh-client/);
  assert.match(dockerfile, /github-cli|\bgh\b/);
});

test("main compose grants opencode direct host access and shared git auth", () => {
  /* OpenCode must see host SSH keys, gh auth state, and git credential helper wiring on the VDS. */
  const compose = readRepoFile("docker-compose.yml");

  assert.match(compose, /working_dir: \$\{PROJECTS_ROOT:\?PROJECTS_ROOT must be set\}/);
  assert.match(compose, /- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(compose, /- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /- \/:\/hostfs/);
  assert.match(compose, /GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /GIT_CONFIG_VALUE_0=!gh auth git-credential/);
});

test("main compose grants backend shared host git auth", () => {
  /* Backend must use the same host-level credentials as OpenCode when cloning new private repositories. */
  const compose = readRepoFile("docker-compose.yml");

  assert.match(compose, /backend:[\s\S]*- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /backend:[\s\S]*- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_VALUE_0=!gh auth git-credential/);
});

test("runtime template keeps opencode host access and shared git auth", () => {
  /* Installed runtime must preserve the same operator capabilities after image-only rollout. */
  const compose = readRepoFile("scripts/templates/runtime-docker-compose.yml");

  assert.match(compose, /working_dir: \$\{PROJECTS_ROOT:\?PROJECTS_ROOT must be set\}/);
  assert.match(compose, /- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(compose, /- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /- \/:\/hostfs/);
  assert.match(compose, /GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /GIT_CONFIG_VALUE_0=!gh auth git-credential/);
});

test("runtime template grants backend shared host git auth", () => {
  /* Fresh VDS installs must clone private repos without per-project credential reconfiguration. */
  const compose = readRepoFile("scripts/templates/runtime-docker-compose.yml");

  assert.match(compose, /backend:[\s\S]*- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /backend:[\s\S]*- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_VALUE_0=!gh auth git-credential/);
});

test("dev compose keeps opencode host access and shared git auth", () => {
  /* Local dev stack should mirror server-side auth behavior for reproducible debugging. */
  const compose = readRepoFile("docker-compose.dev.yml");

  assert.match(compose, /working_dir: \$\{PROJECTS_ROOT:-\/srv\/projects\}/);
  assert.match(compose, /- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(compose, /- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /- \/:\/hostfs/);
  assert.match(compose, /GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /GIT_CONFIG_VALUE_0=!gh auth git-credential/);
});

test("dev compose grants backend shared host git auth", () => {
  /* Local backend behavior must match the VDS path for private repository onboarding. */
  const compose = readRepoFile("docker-compose.dev.yml");

  assert.match(compose, /backend:[\s\S]*- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /backend:[\s\S]*- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_VALUE_0=!gh auth git-credential/);
});
