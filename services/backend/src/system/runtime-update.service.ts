/**
 * @fileoverview Runtime version, update and rollback operations for image-only installs.
 *
 * Exports:
 * - RuntimeVersionSnapshot - Current/available runtime version state for Mini App.
 * - RuntimeUpdateState - Persisted update progress that survives backend restarts.
 * - RuntimeUpdateResult - Result payload for update and rollback actions.
 * - RuntimeUpdateService - Reads runtime .env, checks GitHub releases, updates image refs and applies Compose.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { GithubAppService } from "../github/github-app.service";
import { writeJsonFileSyncAtomic } from "../storage/json-file";
import { applyRuntimeComposeUpdate, buildRuntimeComposeArgs } from "./runtime-compose-update";
import { assertRuntimeUpdateDiskSpace } from "./runtime-disk-space";
import { fetchLatestRuntimeVersion, LatestRuntimeVersion } from "./runtime-github-release";
import { pruneOldRuntimeImages } from "./runtime-image-cleanup";
import { readFreshRuntimeLatestReleaseCache, writeRuntimeLatestReleaseCache } from "./runtime-latest-release-cache";

const RUNTIME_ENV_FILE = ".env";
const RUNTIME_PREVIOUS_ENV_FILE = ".env.previous";
const RUNTIME_UPDATE_STATE_FILE = "runtime-update-state.json";
const PROC_SELF_MOUNTINFO_FILE = "/proc/self/mountinfo";
const RVS_IMAGE_PREFIX = "ghcr.io/nyxandro/remote-vibe-station";
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export type RuntimeVersionSnapshot = {
  runtimeConfigDir: string;
  currentVersion: string;
  currentImageTag: string;
  currentCommitSha: string | null;
  latestVersion: string | null;
  latestImageTag: string | null;
  latestReleaseNotes: string | null;
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

export type RuntimeUpdateStepId = "checking" | "pulling" | "switching" | "restarting" | "verifying";

export type RuntimeUpdateState = {
  status: "idle" | "checking" | "available" | "updating" | "restarting" | "completed" | "failed";
  currentVersion: string | null;
  targetVersion: string | null;
  targetImageTag: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  error: string | null;
  steps: Array<{
    id: RuntimeUpdateStepId;
    label: string;
    status: "pending" | "running" | "completed" | "failed";
  }>;
};

export type RuntimeUpdateResult = {
  applied: boolean;
  previous: RuntimeVersionSnapshot;
  current: RuntimeVersionSnapshot;
};

type RuntimeLatestVersionCheckOptions = {
  forceRefresh?: boolean;
};

type RuntimeUpdateDeps = {
  runtimeConfigDir: () => string;
  runtimeHostConfigDir: () => string;
  mountInfoPath: () => string;
  now: () => number;
  fetchLatestVersion: () => Promise<LatestRuntimeVersion>;
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>;
};

type NormalizedLatestRuntimeVersion = { version: string; imageTag: string; commitSha: string | null; releaseNotes: string | null; checkedAt: string };

@Injectable()
export class RuntimeUpdateService {
  private latestCache: NormalizedLatestRuntimeVersion | null = null;
  private readonly deps: RuntimeUpdateDeps;
  @Optional() @Inject(GithubAppService) private readonly githubApp?: GithubAppService;

  public constructor(@Optional() deps?: Partial<RuntimeUpdateDeps>) {
    /* Dependencies stay injectable so update flows can be unit-tested without Docker or network access. */
    this.deps = {
      runtimeConfigDir: deps?.runtimeConfigDir ?? (() => this.requireRuntimeConfigDir()),
      runtimeHostConfigDir: deps?.runtimeHostConfigDir ?? (() => this.resolveRuntimeHostConfigDir(this.deps.runtimeConfigDir())),
      mountInfoPath: deps?.mountInfoPath ?? (() => PROC_SELF_MOUNTINFO_FILE),
      now: deps?.now ?? (() => Date.now()),
      fetchLatestVersion: deps?.fetchLatestVersion ?? (() => fetchLatestRuntimeVersion(this.githubApp)),
      runCommand: deps?.runCommand ?? ((command, args, cwd) => this.runCommand(command, args, cwd))
    };
  }

  public async getVersionSnapshot(): Promise<RuntimeVersionSnapshot> {
    /* Status reads are local and must not depend on outbound GitHub availability. */
    return this.buildSnapshot(this.readEnvFile(), this.deps.runtimeConfigDir());
  }

  public async getUpdateState(): Promise<RuntimeUpdateState> {
    /* Restarting state is finalized after backend comes back on the new version. */
    const state = this.readUpdateState();
    const current = await this.getVersionSnapshot();
    if (state.status === "restarting" && state.targetVersion === current.currentVersion) {
      return this.writeUpdateState({
        ...state,
        status: "completed",
        currentVersion: current.currentVersion,
        error: null,
        updatedAt: this.isoNow(),
        steps: this.markSteps("verifying", "completed")
      });
    }
    return state;
  }

  public async checkLatestVersion(options?: RuntimeLatestVersionCheckOptions): Promise<RuntimeVersionSnapshot> {
    /* Daily persisted cache prevents self-hosted installs from spending GitHub anonymous API quota. */
    const release = await this.readLatestReleaseWithCache(options);
    this.latestCache = release;
    const snapshot = await this.getVersionSnapshot();
    this.writeUpdateState(this.buildState(snapshot.updateAvailable ? "available" : "idle", snapshot.currentVersion, release.version, release.imageTag, null, "checking"));
    return snapshot;
  }

  public async updateToLatest(): Promise<RuntimeUpdateResult> {
    /* Update uses the latest checked release, fetching it first when the UI did not check explicitly. */
    const before = await this.checkLatestVersion({ forceRefresh: true });
    if (!this.latestCache) {
      throw new Error("APP_RUNTIME_LATEST_VERSION_MISSING: Latest runtime version is unavailable. Check for updates first and retry.");
    }

    if (!before.updateAvailable) {
      return { applied: false, previous: before, current: before };
    }

    this.writeUpdateState(this.buildState("updating", before.currentVersion, this.latestCache.version, this.latestCache.imageTag, null, "switching"));
    let restartStarted = false;
    try {
      await this.writeVersionedEnv({ version: this.latestCache.version, imageTag: this.latestCache.imageTag, commitSha: this.latestCache.commitSha });
      this.writeUpdateState(this.buildState("updating", before.currentVersion, this.latestCache.version, this.latestCache.imageTag, null, "pulling"));
      await this.pullRuntimeImages();
      this.writeUpdateState(this.buildState("restarting", before.currentVersion, this.latestCache.version, this.latestCache.imageTag, null, "restarting"));
      restartStarted = true;
      await this.applyRuntimeCompose();
      return { applied: true, previous: before, current: await this.getVersionSnapshot() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!restartStarted) {
        this.restorePreviousEnvIfAvailable();
      }
      this.writeUpdateState(this.buildState("failed", before.currentVersion, this.latestCache.version, this.latestCache.imageTag, message, restartStarted ? "restarting" : "pulling"));
      throw error;
    }
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
      currentImageTag: env.RVS_RUNTIME_IMAGE_TAG?.trim() || currentVersion,
      currentCommitSha: env.RVS_RUNTIME_COMMIT_SHA?.trim() || null,
      latestVersion: this.latestCache?.version ?? null,
      latestImageTag: this.latestCache?.imageTag ?? null,
      latestReleaseNotes: this.latestCache?.releaseNotes ?? null,
      latestCheckedAt: this.latestCache?.checkedAt ?? null,
      updateAvailable: Boolean(this.latestCache?.version && this.latestCache.version !== currentVersion),
      images,
      rollbackAvailable: fs.existsSync(path.join(runtimeConfigDir, RUNTIME_PREVIOUS_ENV_FILE))
    };
  }

  private async writeVersionedEnv(input: { version: string; imageTag: string; commitSha: string | null }): Promise<void> {
    /* Save previous .env before replacing image refs so rollback has an exact runtime snapshot. */
    const runtimeDir = this.deps.runtimeConfigDir();
    const envPath = path.join(runtimeDir, RUNTIME_ENV_FILE);
    fs.copyFileSync(envPath, path.join(runtimeDir, RUNTIME_PREVIOUS_ENV_FILE));
    const env = this.readEnvFile();
    env.RVS_RUNTIME_VERSION = input.version;
    env.RVS_RUNTIME_IMAGE_TAG = input.imageTag;
    env.RVS_RUNTIME_COMMIT_SHA = input.commitSha ?? "";
    env.RVS_BACKEND_IMAGE = `${RVS_IMAGE_PREFIX}-backend:${input.imageTag}`;
    env.RVS_MINIAPP_IMAGE = `${RVS_IMAGE_PREFIX}-miniapp:${input.imageTag}`;
    env.RVS_BOT_IMAGE = `${RVS_IMAGE_PREFIX}-bot:${input.imageTag}`;
    env.RVS_OPENCODE_IMAGE = `${RVS_IMAGE_PREFIX}-opencode:${input.imageTag}`;
    fs.writeFileSync(envPath, this.serializeEnv(env), "utf-8");
  }

  private async pullRuntimeImages(): Promise<void> {
    /* Cleanup preserves target/rollback tags, then preflights disk before pulling fresh image layers. */
    const runtimeDir = this.deps.runtimeConfigDir();
    await this.pruneOldImagesBeforePull();
    assertRuntimeUpdateDiskSpace(runtimeDir);
    const args = buildRuntimeComposeArgs(runtimeDir, this.deps.runtimeHostConfigDir());
    await this.deps.runCommand("docker", ["compose", ...args, "pull"], runtimeDir);
  }

  private async pruneOldImagesBeforePull(): Promise<void> {
    /* Old runtime image tags are large; remove them automatically without touching volumes or rollback refs. */
    const runtimeDir = this.deps.runtimeConfigDir();
    const envSnapshots = [this.readEnvFile()];
    const previousPath = path.join(runtimeDir, RUNTIME_PREVIOUS_ENV_FILE);
    if (fs.existsSync(previousPath)) {
      envSnapshots.push(this.readEnvFileAt(previousPath));
    }
    await pruneOldRuntimeImages({ runtimeDir, envSnapshots, runCommand: this.deps.runCommand });
  }

  private restorePreviousEnvIfAvailable(): void {
    /* Failed pre-restart updates should leave the currently running runtime pinned to the previous refs. */
    const runtimeDir = this.deps.runtimeConfigDir();
    const previousPath = path.join(runtimeDir, RUNTIME_PREVIOUS_ENV_FILE);
    if (fs.existsSync(previousPath)) {
      fs.copyFileSync(previousPath, path.join(runtimeDir, RUNTIME_ENV_FILE));
    }
  }

  private async applyRuntimeCompose(): Promise<void> {
    /* Backend self-restart is delegated to a detached helper so killing this container does not abort Compose. */
    const runtimeDir = this.deps.runtimeConfigDir();
    const env = this.readEnvFile();
    await applyRuntimeComposeUpdate({
      runtimeDir,
      runtimeHostDir: this.deps.runtimeHostConfigDir(),
      backendImage: this.requireEnv(env, "RVS_BACKEND_IMAGE"),
      runCommand: this.deps.runCommand
    });
  }

  private readEnvFile(): Record<string, string> {
    /* Parse simple KEY=value runtime env files generated by the installer. */
    const runtimeDir = this.deps.runtimeConfigDir();
    const envPath = path.join(runtimeDir, RUNTIME_ENV_FILE);
    if (!fs.existsSync(envPath)) {
      throw new Error(`APP_RUNTIME_ENV_MISSING: Runtime .env is missing at ${envPath}. Re-run installer or restore runtime config.`);
    }

    return this.readEnvFileAt(envPath);
  }

  private readEnvFileAt(envPath: string): Record<string, string> {
    /* Shared parser is used for current and previous env snapshots that protect rollback image tags. */
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

  private resolveRuntimeHostConfigDir(runtimeDir: string): string {
    /* Mountinfo exposes the host source for /runtime-config without adding another required env var. */
    const normalizedRuntimeDir = path.resolve(runtimeDir);
    const mountInfoPath = this.deps.mountInfoPath();
    const mountInfo = fs.existsSync(mountInfoPath) ? fs.readFileSync(mountInfoPath, "utf-8") : "";
    for (const line of mountInfo.split(/\r?\n/)) {
      const fields = line.split(" ");
      if (fields.length < 10 || fields[4] !== normalizedRuntimeDir) {
        continue;
      }

      const hostSource = this.decodeMountInfoPath(fields[3]);
      if (hostSource.trim()) {
        return hostSource;
      }
    }

    throw new Error(`APP_RUNTIME_HOST_CONFIG_DIR_UNRESOLVED: Unable to resolve host path for ${runtimeDir} from ${mountInfoPath}. Restart backend from the runtime Docker Compose stack.`);
  }

  private decodeMountInfoPath(value: string): string {
    /* Linux mountinfo escapes spaces and other bytes as octal sequences. */
    return value.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
  }

  private async readLatestReleaseWithCache(options?: RuntimeLatestVersionCheckOptions): Promise<NormalizedLatestRuntimeVersion> {
    /* Cached latest release is fine for passive reads, but operator-triggered checks must be able to bypass it. */
    const runtimeDir = this.deps.runtimeConfigDir();
    const cached = options?.forceRefresh ? null : readFreshRuntimeLatestReleaseCache(runtimeDir, this.deps.now());
    if (cached) {
      return cached;
    }

    const release = this.normalizeLatestRelease(await this.deps.fetchLatestVersion(), this.isoNow());
    writeRuntimeLatestReleaseCache(runtimeDir, release);
    return release;
  }

  private normalizeLatestRelease(release: LatestRuntimeVersion, checkedAt: string): NormalizedLatestRuntimeVersion {
    /* Release identity is required; metadata remains nullable because public fallback exposes only the tag. */
    const version = typeof release.version === "string" ? release.version.trim() : "";
    if (!version) {
      throw new Error("APP_RUNTIME_LATEST_VERSION_INVALID: GitHub release response does not include a version tag. Retry later or create a release.");
    }
    const imageTag = typeof release.imageTag === "string" && release.imageTag.trim().length > 0 ? release.imageTag.trim() : version;
    const commitSha = typeof release.commitSha === "string" && release.commitSha.trim().length > 0 ? release.commitSha.trim() : null;
    const releaseNotes = typeof release.releaseNotes === "string" && release.releaseNotes.trim().length > 0 ? release.releaseNotes.trim() : null;
    return { version, imageTag, commitSha, releaseNotes, checkedAt };
  }

  private readUpdateState(): RuntimeUpdateState {
    /* State is persisted next to .env so a backend restart can resume the operator-facing status. */
    const statePath = path.join(this.deps.runtimeConfigDir(), RUNTIME_UPDATE_STATE_FILE);
    if (!fs.existsSync(statePath)) {
      const snapshotEnv = fs.existsSync(path.join(this.deps.runtimeConfigDir(), RUNTIME_ENV_FILE)) ? this.readEnvFile() : {};
      return this.buildState("idle", snapshotEnv.RVS_RUNTIME_VERSION ?? null, null, null, null, null);
    }
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf-8")) as RuntimeUpdateState;
    } catch (error) {
      /* Old versions could truncate this file on ENOSPC; recover Settings instead of breaking the UI. */
      const snapshotEnv = fs.existsSync(path.join(this.deps.runtimeConfigDir(), RUNTIME_ENV_FILE)) ? this.readEnvFile() : {};
      const state = this.buildState("failed", snapshotEnv.RVS_RUNTIME_VERSION ?? null, null, null, `APP_RUNTIME_UPDATE_STATE_CORRUPT: Runtime update state is not valid JSON. Previous state was moved aside. ${error instanceof Error ? error.message : String(error)}`, "checking");
      fs.renameSync(statePath, `${statePath}.corrupt-${Date.now()}`);
      return this.writeUpdateState(state);
    }
  }

  private writeUpdateState(state: RuntimeUpdateState): RuntimeUpdateState {
    /* Atomic enough for one backend writer and readable by the restarted backend. */
    writeJsonFileSyncAtomic(path.join(this.deps.runtimeConfigDir(), RUNTIME_UPDATE_STATE_FILE), state);
    return state;
  }

  private buildState(status: RuntimeUpdateState["status"], currentVersion: string | null, targetVersion: string | null, targetImageTag: string | null, error: string | null, activeStep: RuntimeUpdateStepId | null): RuntimeUpdateState {
    const previous = this.readUpdateStateFileOnly();
    return {
      status,
      currentVersion,
      targetVersion,
      targetImageTag,
      startedAt: status === "idle" ? null : (previous?.startedAt ?? this.isoNow()),
      updatedAt: this.isoNow(),
      error,
      steps: this.markSteps(activeStep, status === "failed" ? "failed" : status === "completed" ? "completed" : "running")
    };
  }

  private readUpdateStateFileOnly(): RuntimeUpdateState | null {
    try {
      const statePath = path.join(this.deps.runtimeConfigDir(), RUNTIME_UPDATE_STATE_FILE);
      return fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf-8")) as RuntimeUpdateState : null;
    } catch {
      return null;
    }
  }

  private markSteps(activeStep: RuntimeUpdateStepId | null, activeStatus: "running" | "completed" | "failed"): RuntimeUpdateState["steps"] {
    const steps: Array<{ id: RuntimeUpdateStepId; label: string }> = [
      { id: "checking", label: "Checking release" },
      { id: "pulling", label: "Downloading images" },
      { id: "switching", label: "Preparing runtime" },
      { id: "restarting", label: "Restarting services" },
      { id: "verifying", label: "Verifying update" }
    ];
    const activeIndex = activeStep ? steps.findIndex((step) => step.id === activeStep) : -1;
    return steps.map((step, index) => ({
      ...step,
      status: activeIndex === -1 || index < activeIndex ? "completed" : index === activeIndex ? activeStatus : "pending"
    }));
  }

  private isoNow(): string {
    return new Date(this.deps.now()).toISOString();
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
