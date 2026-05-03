/**
 * @fileoverview Runtime version, update and rollback operations for image-only installs.
 *
 * Exports:
 * - RuntimeVersionSnapshot - Current/available runtime version state for Mini App.
 * - RuntimeUpdateResult - Result payload for update and rollback actions.
 * - RuntimeUpdateService - Reads runtime .env, checks GitHub releases, updates image refs and applies Compose.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

import { Injectable, Optional } from "@nestjs/common";

const RUNTIME_ENV_FILE = ".env";
const RUNTIME_PREVIOUS_ENV_FILE = ".env.previous";
const GITHUB_MASTER_REF_URL = "https://api.github.com/repos/nyxandro/remote-vibe-station/commits/master";
const RVS_IMAGE_PREFIX = "ghcr.io/nyxandro/remote-vibe-station";
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export type RuntimeVersionSnapshot = {
  runtimeConfigDir: string;
  currentVersion: string;
  currentCommitSha: string | null;
  latestVersion: string | null;
  latestCheckedAt: string | null;
  updateAvailable: boolean;
  images: {
    backend: string;
    miniapp: string;
    bot: string;
    opencode: string;
  };
  rollbackAvailable: boolean;
};

export type RuntimeUpdateResult = {
  applied: boolean;
  previous: RuntimeVersionSnapshot;
  current: RuntimeVersionSnapshot;
};

type LatestRuntimeVersion = {
  version?: string;
  commitSha?: string | null;
};

type RuntimeUpdateDeps = {
  runtimeConfigDir: () => string;
  now: () => number;
  fetchLatestVersion: () => Promise<LatestRuntimeVersion>;
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>;
};

@Injectable()
export class RuntimeUpdateService {
  private latestCache: { version: string; commitSha: string | null; checkedAt: string } | null = null;
  private readonly deps: RuntimeUpdateDeps;

  public constructor(@Optional() deps?: Partial<RuntimeUpdateDeps>) {
    /* Dependencies stay injectable so update flows can be unit-tested without Docker or network access. */
    this.deps = {
      runtimeConfigDir: deps?.runtimeConfigDir ?? (() => this.requireRuntimeConfigDir()),
      now: deps?.now ?? (() => Date.now()),
      fetchLatestVersion: deps?.fetchLatestVersion ?? (() => this.fetchLatestVersion()),
      runCommand: deps?.runCommand ?? ((command, args, cwd) => this.runCommand(command, args, cwd))
    };
  }

  public async getVersionSnapshot(): Promise<RuntimeVersionSnapshot> {
    /* Status reads are local and must not depend on outbound GitHub availability. */
    return this.buildSnapshot(this.readEnvFile(), this.deps.runtimeConfigDir());
  }

  public async checkLatestVersion(): Promise<RuntimeVersionSnapshot> {
    /* GitHub release check is explicit because network errors should not block opening Settings. */
    const release = await this.deps.fetchLatestVersion();
    const version = typeof release.version === "string" ? release.version.trim() : "";
    if (!version) {
      throw new Error("APP_RUNTIME_LATEST_VERSION_INVALID: GitHub master commit response does not include a runtime image tag. Retry later or update by explicit image tag.");
    }

    const commitSha = typeof release.commitSha === "string" && release.commitSha.trim().length > 0
      ? release.commitSha.trim()
      : null;
    this.latestCache = { version, commitSha, checkedAt: new Date(this.deps.now()).toISOString() };
    return this.getVersionSnapshot();
  }

  public async updateToLatest(): Promise<RuntimeUpdateResult> {
    /* Update uses the latest checked release, fetching it first when the UI did not check explicitly. */
    const before = await this.checkLatestVersion();
    if (!this.latestCache) {
      throw new Error("APP_RUNTIME_LATEST_VERSION_MISSING: Latest runtime version is unavailable. Check for updates first and retry.");
    }

    if (!before.updateAvailable) {
      return { applied: false, previous: before, current: before };
    }

    await this.writeVersionedEnv({ version: this.latestCache.version, commitSha: this.latestCache.commitSha });
    await this.applyRuntimeCompose();
    return { applied: true, previous: before, current: await this.getVersionSnapshot() };
  }

  public async rollback(): Promise<RuntimeUpdateResult> {
    /* Rollback restores the last saved .env and applies Compose with those image refs. */
    const runtimeDir = this.deps.runtimeConfigDir();
    const envPath = path.join(runtimeDir, RUNTIME_ENV_FILE);
    const previousPath = path.join(runtimeDir, RUNTIME_PREVIOUS_ENV_FILE);
    const before = await this.getVersionSnapshot();
    if (!fs.existsSync(previousPath)) {
      throw new Error("APP_RUNTIME_ROLLBACK_UNAVAILABLE: Previous runtime .env is missing. Update once before retrying rollback.");
    }

    fs.copyFileSync(envPath, `${envPath}.rollback-current`);
    fs.copyFileSync(previousPath, envPath);
    await this.applyRuntimeCompose();
    return { applied: true, previous: before, current: await this.getVersionSnapshot() };
  }

  private buildSnapshot(env: Record<string, string>, runtimeConfigDir: string): RuntimeVersionSnapshot {
    /* Runtime image refs are required for safe update/rollback operations. */
    const currentVersion = this.requireEnv(env, "RVS_RUNTIME_VERSION");
    const images = {
      backend: this.requireEnv(env, "RVS_BACKEND_IMAGE"),
      miniapp: this.requireEnv(env, "RVS_MINIAPP_IMAGE"),
      bot: this.requireEnv(env, "RVS_BOT_IMAGE"),
      opencode: this.requireEnv(env, "RVS_OPENCODE_IMAGE")
    };

    return {
      runtimeConfigDir,
      currentVersion,
      currentCommitSha: env.RVS_RUNTIME_COMMIT_SHA?.trim() || null,
      latestVersion: this.latestCache?.version ?? null,
      latestCheckedAt: this.latestCache?.checkedAt ?? null,
      updateAvailable: Boolean(this.latestCache?.version && this.latestCache.version !== currentVersion),
      images,
      rollbackAvailable: fs.existsSync(path.join(runtimeConfigDir, RUNTIME_PREVIOUS_ENV_FILE))
    };
  }

  private async writeVersionedEnv(input: { version: string; commitSha: string | null }): Promise<void> {
    /* Save previous .env before replacing image refs so rollback has an exact runtime snapshot. */
    const runtimeDir = this.deps.runtimeConfigDir();
    const envPath = path.join(runtimeDir, RUNTIME_ENV_FILE);
    fs.copyFileSync(envPath, path.join(runtimeDir, RUNTIME_PREVIOUS_ENV_FILE));
    const env = this.readEnvFile();
    env.RVS_RUNTIME_VERSION = input.version;
    env.RVS_RUNTIME_COMMIT_SHA = input.commitSha ?? "";
    env.RVS_BACKEND_IMAGE = `${RVS_IMAGE_PREFIX}-backend:${input.version}`;
    env.RVS_MINIAPP_IMAGE = `${RVS_IMAGE_PREFIX}-miniapp:${input.version}`;
    env.RVS_BOT_IMAGE = `${RVS_IMAGE_PREFIX}-bot:${input.version}`;
    env.RVS_OPENCODE_IMAGE = `${RVS_IMAGE_PREFIX}-opencode:${input.version}`;
    fs.writeFileSync(envPath, this.serializeEnv(env), "utf-8");
  }

  private async applyRuntimeCompose(): Promise<void> {
    /* Pull before up so unavailable tags fail before the current containers are replaced. */
    const runtimeDir = this.deps.runtimeConfigDir();
    const args = ["--env-file", ".env", "-f", "docker-compose.yml", "-f", "docker-compose.vless.yml"];
    await this.deps.runCommand("docker", ["compose", ...args, "pull"], runtimeDir);
    await this.deps.runCommand("docker", ["compose", ...args, "up", "-d", "--remove-orphans"], runtimeDir);
  }

  private readEnvFile(): Record<string, string> {
    /* Parse simple KEY=value runtime env files generated by the installer. */
    const runtimeDir = this.deps.runtimeConfigDir();
    const envPath = path.join(runtimeDir, RUNTIME_ENV_FILE);
    if (!fs.existsSync(envPath)) {
      throw new Error(`APP_RUNTIME_ENV_MISSING: Runtime .env is missing at ${envPath}. Re-run installer or restore runtime config.`);
    }

    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      env[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
    }
    return env;
  }

  private serializeEnv(env: Record<string, string>): string {
    /* Preserve deterministic key order for runtime-controlled fields after updates. */
    return Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
  }

  private requireEnv(env: Record<string, string>, key: string): string {
    /* Required runtime fields must fail loudly because update operations depend on exact image refs. */
    const value = env[key]?.trim();
    if (!value) {
      throw new Error(`APP_RUNTIME_ENV_REQUIRED: ${key} is missing in runtime .env. Re-run installer or restore runtime config.`);
    }
    return value;
  }

  private requireRuntimeConfigDir(): string {
    /* Backend container receives this mount from the runtime compose template. */
    const value = process.env.RUNTIME_CONFIG_DIR?.trim();
    if (!value) {
      throw new Error("APP_RUNTIME_CONFIG_DIR_REQUIRED: RUNTIME_CONFIG_DIR is not set. Start backend from the runtime compose stack.");
    }
    return value;
  }

  private async fetchLatestVersion(): Promise<LatestRuntimeVersion> {
    /* Runtime images are published as sha-<master commit>, so master commit metadata is the source of truth. */
    const response = await fetch(GITHUB_MASTER_REF_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) {
      throw new Error(`APP_RUNTIME_RELEASE_CHECK_FAILED: GitHub master commit request failed with HTTP ${response.status}. Retry later.`);
    }
    const payload = (await response.json()) as { sha?: string };
    const commitSha = typeof payload.sha === "string" && payload.sha.trim().length > 0 ? payload.sha.trim() : "";
    return { version: commitSha ? `sha-${commitSha}` : "", commitSha };
  }

  private async runCommand(command: string, args: string[], cwd: string): Promise<void> {
    /* Docker compose can take several minutes when pulling fresh images. */
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: "pipe" });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`APP_RUNTIME_COMMAND_TIMEOUT: Runtime command timed out after ${COMMAND_TIMEOUT_MS}ms: ${command} ${args.join(" ")}`));
      }, COMMAND_TIMEOUT_MS);
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`APP_RUNTIME_COMMAND_FAILED: Runtime command failed with exit code ${code}: ${command} ${args.join(" ")}. ${stderr.trim()}`));
      });
    });
  }
}
