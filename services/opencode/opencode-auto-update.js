/**
 * @fileoverview Boot-time and on-demand OpenCode updater for the shared dev runtime.
 *
 * Exports:
 * - ensureOpenCodeAutoUpdate - Checks npm latest, updates the toolbox install, and reports the outcome.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const OPENCODE_NPM_PACKAGE = "opencode-ai";
const CACHE_FILE_NAME = "opencode-version-check.json";
const DEFAULT_TTL_HOURS = 12;

const parseSemver = (input) => {
  /* npm and opencode CLI output may contain extra text, so extract a plain semver token defensively. */
  if (typeof input !== "string") {
    return null;
  }

  const match = input.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0] : null;
};

const parseBooleanEnv = (value, fallback) => {
  /* Runtime env toggles should accept common truthy/falsey forms without forcing exact casing. */
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

const parseTtlHours = (value) => {
  /* Invalid TTL env should not break startup; clamp to a sane default. */
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_HOURS;
};

const readJsonFile = (filePath) => {
  /* Cache files are best-effort only; ignore corruption and refresh from npm when needed. */
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const writeJsonFile = (filePath, value) => {
  /* Human-readable cache files help operators inspect the currently pinned latest version. */
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
};

const runCommand = async (command, args) => {
  /* Small subprocess wrapper keeps updater logic deterministic and easy to mock in tests. */
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if ((code ?? 1) !== 0) {
        const stderrText = stderr.trim();
        const stdoutText = stdout.trim();
        const diagnostics = [stderrText ? `stderr=${stderrText}` : null, stdoutText ? `stdout=${stdoutText}` : null]
          .filter(Boolean)
          .join(" ");
        reject(new Error(`${command} ${args.join(" ")} failed${diagnostics ? `: ${diagnostics}` : ""}`));
        return;
      }

      resolve(stdout);
    });
  });
};

const readInstalledVersion = async (input) => {
  /* Prefer the effective opencode binary from PATH so toolbox installs override the image fallback naturally. */
  const output = await input.runCommand("opencode", ["--version"]);
  const parsed = parseSemver(output);
  if (!parsed) {
    throw new Error(`Failed to parse installed OpenCode version from output: ${output.trim()}`);
  }
  return parsed;
};

const readLatestVersion = async (input) => {
  /* npm registry remains the source of truth for latest dev runtime version. */
  const output = await input.runCommand("npm", ["view", OPENCODE_NPM_PACKAGE, "version", "--json"]);
  const parsed = parseSemver(output.replaceAll('"', ""));
  if (!parsed) {
    throw new Error(`Failed to parse latest OpenCode npm version: ${output.trim()}`);
  }
  return parsed;
};

const resolveLatestVersion = async (input) => {
  /* Cache npm lookups so routine restarts stay fast while still self-healing over time. */
  const cache = readJsonFile(input.cachePath);
  const freshUntilMs = cache?.checkedAt ? Date.parse(cache.checkedAt) + input.ttlMs : Number.NaN;
  const isFresh = !input.force && cache?.latestVersion && Number.isFinite(freshUntilMs) && freshUntilMs > input.nowMs;

  if (isFresh) {
    return {
      latestVersion: cache.latestVersion,
      checkedAt: cache.checkedAt,
      source: "cache"
    };
  }

  const latestVersion = await readLatestVersion(input);
  const checkedAt = new Date(input.nowMs).toISOString();
  writeJsonFile(input.cachePath, { latestVersion, checkedAt });

  return {
    latestVersion,
    checkedAt,
    source: "registry"
  };
};

const installLatestVersion = async (input) => {
  /* Global npm installs land in /toolbox/npm-global because the container exports NPM_CONFIG_PREFIX there. */
  await input.runCommand("npm", ["install", "-g", `${OPENCODE_NPM_PACKAGE}@${input.latestVersion}`]);
};

const ensureOpenCodeAutoUpdate = async (input = {}) => {
  /* One helper serves both startup auto-update and button-triggered force update paths. */
  const toolboxRoot = input.toolboxRoot ?? process.env.TOOLBOX_ROOT ?? "/toolbox";
  const enabled = typeof input.enabled === "boolean" ? input.enabled : parseBooleanEnv(process.env.OPENCODE_AUTO_UPDATE, true);
  const force = Boolean(input.force);
  const ttlMs = (typeof input.ttlHours === "number" ? input.ttlHours : parseTtlHours(process.env.OPENCODE_AUTO_UPDATE_TTL_HOURS)) * 60 * 60 * 1000;
  const nowMs = input.nowMs ?? Date.now();
  const cachePath = input.cachePath ?? path.join(toolboxRoot, CACHE_FILE_NAME);
  const runner = input.runCommand ?? runCommand;

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });

  const currentVersion = await readInstalledVersion({ runCommand: runner });
  if (!enabled && !force) {
    return {
      enabled: false,
      updated: false,
      currentVersion,
      latestVersion: currentVersion,
      checkedAt: null,
      source: "disabled"
    };
  }

  const latest = await resolveLatestVersion({ cachePath, force, nowMs, runCommand: runner, ttlMs });
  if (latest.latestVersion === currentVersion) {
    return {
      enabled: true,
      updated: false,
      currentVersion,
      latestVersion: latest.latestVersion,
      checkedAt: latest.checkedAt,
      source: latest.source
    };
  }

  await installLatestVersion({ latestVersion: latest.latestVersion, runCommand: runner });
  const installedVersion = await readInstalledVersion({ runCommand: runner });

  return {
    enabled: true,
    updated: installedVersion === latest.latestVersion,
    currentVersion: installedVersion,
    latestVersion: latest.latestVersion,
    checkedAt: latest.checkedAt,
    source: latest.source
  };
};

if (require.main === module) {
  /* CLI mode supports both startup checks and manual force-updates triggered from backend actions. */
  const force = process.argv.includes("--force");

  ensureOpenCodeAutoUpdate({ force })
    .then((result) => {
      process.stdout.write(JSON.stringify(result) + "\n");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`APP_OPENCODE_AUTO_UPDATE_FAILED: ${message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  ensureOpenCodeAutoUpdate
};
