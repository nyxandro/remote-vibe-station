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
  assert.match(dockerfile, /python3/);
  assert.match(dockerfile, /pipx/);
  assert.match(dockerfile, /ripgrep/);
  assert.match(dockerfile, /fd-find/);
  assert.match(dockerfile, /chromium/);
  assert.match(dockerfile, /playwright/);
  assert.match(dockerfile, /XDG_CACHE_HOME=\/toolbox\/cache/);
  assert.match(dockerfile, /NPM_CONFIG_PREFIX=\/toolbox\/npm-global/);
  assert.match(dockerfile, /NPM_CONFIG_CACHE=\/toolbox\/cache\/npm/);
  assert.match(dockerfile, /PNPM_STORE_DIR=\/toolbox\/pnpm\/store/);
  assert.match(dockerfile, /PIPX_BIN_DIR=\/toolbox\/bin/);
  assert.match(dockerfile, /PIP_CACHE_DIR=\/toolbox\/cache\/pip/);
  assert.match(dockerfile, /PYTHONUSERBASE=\/toolbox\/python-user/);
  assert.match(dockerfile, /UV_CACHE_DIR=\/toolbox\/cache\/uv/);
  assert.match(dockerfile, /NODE_PATH=\/toolbox\/npm-global\/lib\/node_modules/);
  assert.match(dockerfile, /COPY toolbox-profile\.sh \/etc\/profile\.d\/toolbox\.sh/);
  assert.match(dockerfile, /docker-wrapper\.sh/);
  assert.match(dockerfile, /COPY --chmod=755 github-gh-auth-wrapper\.sh \/usr\/local\/bin\/gh/);
});

test("backend Dockerfile installs git ssh and gh tooling", () => {
  /* Backend clone and git-ops endpoints execute git directly, so they need the same auth binaries. */
  const dockerfile = readRepoFile("services/backend/Dockerfile");

  assert.match(dockerfile, /git/);
  assert.match(dockerfile, /openssh-client/);
  assert.match(dockerfile, /github-cli|\bgh\b/);
  assert.match(dockerfile, /COPY --chmod=755 github-gh-auth-wrapper\.sh \/usr\/local\/bin\/gh/);
});

test("main compose grants opencode direct host access and shared git auth", () => {
  /* OpenCode must see host SSH keys and backend-backed git credential helper wiring on the VDS. */
  const compose = readRepoFile("docker-compose.yml");

  assert.match(compose, /working_dir: \$\{PROJECTS_ROOT:\?PROJECTS_ROOT must be set\}/);
  assert.match(compose, /opencode:[\s\S]*- BACKEND_URL=http:\/\/backend:3000/);
  assert.match(compose, /opencode:[\s\S]*- BOT_BACKEND_AUTH_TOKEN=\$\{BOT_BACKEND_AUTH_TOKEN/);
  assert.match(compose, /- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(compose, /- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /- \/:\/hostfs/);
  assert.match(compose, /GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /GIT_CONFIG_VALUE_0=!node \/usr\/local\/bin\/github-git-credential\.js/);
});

test("main compose grants backend shared host git auth", () => {
  /* Backend must use the same backend-minted credentials as OpenCode when cloning private repositories. */
  const compose = readRepoFile("docker-compose.yml");

  assert.match(compose, /backend:[\s\S]*- BACKEND_URL=http:\/\/localhost:3000/);
  assert.match(compose, /backend:[\s\S]*- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /backend:[\s\S]*- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_VALUE_0=!node \/usr\/local\/bin\/github-git-credential\.js/);
});

test("runtime template keeps opencode host access and shared git auth", () => {
  /* Installed runtime must preserve the same operator capabilities after image-only rollout. */
  const compose = readRepoFile("scripts/templates/runtime-docker-compose.yml");

  assert.match(compose, /working_dir: \$\{PROJECTS_ROOT:\?PROJECTS_ROOT must be set\}/);
  assert.match(compose, /opencode:[\s\S]*- BACKEND_URL=http:\/\/backend:3000/);
  assert.match(compose, /opencode:[\s\S]*- BOT_BACKEND_AUTH_TOKEN=\$\{BOT_BACKEND_AUTH_TOKEN\}/);
  assert.match(compose, /- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(compose, /- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /- \/:\/hostfs/);
  assert.match(compose, /- toolbox_data:\/toolbox/);
  assert.match(compose, /GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /GIT_CONFIG_VALUE_0=!node \/usr\/local\/bin\/github-git-credential\.js/);
});

test("runtime template grants backend shared host git auth", () => {
  /* Fresh VDS installs must clone private repos without per-project credential reconfiguration. */
  const compose = readRepoFile("scripts/templates/runtime-docker-compose.yml");

  assert.match(compose, /backend:[\s\S]*- BACKEND_URL=http:\/\/localhost:3000/);
  assert.match(compose, /backend:[\s\S]*- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /backend:[\s\S]*- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_VALUE_0=!node \/usr\/local\/bin\/github-git-credential\.js/);
});

test("dev compose keeps opencode host access and shared git auth", () => {
  /* Local dev stack should mirror server-side auth behavior for reproducible debugging. */
  const compose = readRepoFile("docker-compose.dev.yml");

  assert.match(compose, /working_dir: \$\{PROJECTS_ROOT:-\/srv\/projects\}/);
  assert.match(compose, /opencode:[\s\S]*- BACKEND_URL=http:\/\/backend:3000/);
  assert.match(compose, /opencode:[\s\S]*- BOT_BACKEND_AUTH_TOKEN=\$\{BOT_BACKEND_AUTH_TOKEN:-dev-bot-backend-token\}/);
  assert.match(compose, /- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(compose, /- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /- \/:\/hostfs/);
  assert.match(compose, /- toolbox_data:\/toolbox/);
  assert.match(compose, /GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /GIT_CONFIG_VALUE_0=!node \/usr\/local\/bin\/github-git-credential\.js/);
});

test("dev compose grants backend shared host git auth", () => {
  /* Local backend behavior must match the VDS path for private repository onboarding. */
  const compose = readRepoFile("docker-compose.dev.yml");

  assert.match(compose, /backend:[\s\S]*- BACKEND_URL=http:\/\/localhost:3000/);
  assert.match(compose, /backend:[\s\S]*- \/root\/\.ssh:\/root\/\.ssh/);
  assert.match(compose, /backend:[\s\S]*- \/root\/\.config\/gh:\/root\/\.config\/gh/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_KEY_0=credential\.https:\/\/github\.com\.helper/);
  assert.match(compose, /backend:[\s\S]*GIT_CONFIG_VALUE_0=!node \/usr\/local\/bin\/github-git-credential\.js/);
});
