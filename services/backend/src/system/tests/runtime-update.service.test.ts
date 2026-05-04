/**
 * @fileoverview Tests for RuntimeUpdateService version, update and rollback flows.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { RuntimeUpdateService } from "../runtime-update.service";

const writeRuntimeEnv = (dir: string, version = "sha-old"): void => {
  fs.writeFileSync(
    path.join(dir, ".env"),
    [
      `RVS_RUNTIME_VERSION=${version}`,
      "RVS_RUNTIME_COMMIT_SHA=oldsha",
      `RVS_BACKEND_IMAGE=ghcr.io/nyxandro/remote-vibe-station-backend:${version}`,
      `RVS_MINIAPP_IMAGE=ghcr.io/nyxandro/remote-vibe-station-miniapp:${version}`,
      `RVS_BOT_IMAGE=ghcr.io/nyxandro/remote-vibe-station-bot:${version}`,
      `RVS_OPENCODE_IMAGE=ghcr.io/nyxandro/remote-vibe-station-opencode:${version}`,
      "RVS_CLIPROXY_IMAGE=eceasy/cli-proxy-api:latest"
    ].join("\n") + "\n",
    "utf-8"
  );
};

describe("RuntimeUpdateService", () => {
  afterEach(() => {
    /* Tests stub global fetch and filesystem stats; restore them so one failure cannot poison the suite. */
    jest.restoreAllMocks();
  });

  test("checks latest release and updates runtime env with versioned image refs", async () => {
    /* Update must preserve rollback state and apply the same version tag to every RVS service image. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-update-"));
    writeRuntimeEnv(runtimeDir);
    const runCommand = jest.fn().mockResolvedValue(undefined);
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
      runtimeHostConfigDir: () => "/opt/remote-vibe-station-runtime",
      now: () => Date.parse("2026-05-03T12:00:00.000Z"),
      fetchLatestVersion: jest.fn().mockResolvedValue({ version: "1.2.3", imageTag: "v1.2.3", commitSha: "newsha", releaseNotes: "- Fixed updates" }),
      runCommand
    });

    const checked = await service.checkLatestVersion();
    const result = await service.updateToLatest();
    const env = fs.readFileSync(path.join(runtimeDir, ".env"), "utf-8");

    expect(checked).toMatchObject({ currentVersion: "sha-old", latestVersion: "1.2.3", latestImageTag: "v1.2.3", updateAvailable: true });
    expect(result.applied).toBe(true);
    expect(env).toContain("RVS_RUNTIME_VERSION=1.2.3");
    expect(env).toContain("RVS_RUNTIME_IMAGE_TAG=v1.2.3");
    expect(env).toContain("RVS_RUNTIME_COMMIT_SHA=newsha");
    expect(env).toContain("RVS_BACKEND_IMAGE=ghcr.io/nyxandro/remote-vibe-station-backend:v1.2.3");
    expect(fs.existsSync(path.join(runtimeDir, ".env.previous"))).toBe(true);
    expect(runCommand).toHaveBeenNthCalledWith(1, "sh", expect.arrayContaining(["-lc", expect.stringContaining("docker image rm")]), runtimeDir);
    expect(runCommand).toHaveBeenNthCalledWith(2, "docker", expect.arrayContaining(["compose", "--project-directory", "/opt/remote-vibe-station-runtime", "pull"]), runtimeDir);
    expect(runCommand).toHaveBeenNthCalledWith(3, "docker", expect.arrayContaining(["--project-directory", "/opt/remote-vibe-station-runtime", "miniapp", "bot", "opencode", "cliproxy", "proxy"]), runtimeDir);
    expect(runCommand).toHaveBeenNthCalledWith(4, "docker", expect.arrayContaining(["run", "-d", "--rm", "-v", "/var/run/docker.sock:/var/run/docker.sock", "ghcr.io/nyxandro/remote-vibe-station-backend:v1.2.3"]), runtimeDir);
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, "runtime-update-state.json"), "utf-8"))).toMatchObject({ status: "restarting", targetVersion: "1.2.3" });
  });

  test("reuses persisted latest release cache for one day", async () => {
    /* Repeated update checks should not poll GitHub while a fresh persisted cache is available. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-release-cache-"));
    const fetchLatestVersion = jest.fn().mockResolvedValue({ version: "1.2.3", imageTag: "v1.2.3", commitSha: "newsha", releaseNotes: "Cached release" });
    writeRuntimeEnv(runtimeDir);
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
      now: () => Date.parse("2026-05-03T12:00:00.000Z"),
      fetchLatestVersion
    });

    await service.checkLatestVersion();
    await service.checkLatestVersion();

    expect(fetchLatestVersion).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, "runtime-latest-release-cache.json"), "utf-8"))).toMatchObject({ version: "1.2.3", imageTag: "v1.2.3" });
  });

  test("refreshes persisted latest release cache after one day", async () => {
    /* Stale cache must be refreshed so installations eventually discover new releases without manual cleanup. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-release-cache-stale-"));
    let now = Date.parse("2026-05-03T12:00:00.000Z");
    const fetchLatestVersion = jest.fn()
      .mockResolvedValueOnce({ version: "1.2.3", imageTag: "v1.2.3", commitSha: "oldsha" })
      .mockResolvedValueOnce({ version: "1.2.4", imageTag: "v1.2.4", commitSha: "newsha" });
    writeRuntimeEnv(runtimeDir);
    const service = new RuntimeUpdateService({ runtimeConfigDir: () => runtimeDir, now: () => now, fetchLatestVersion });

    await service.checkLatestVersion();
    now = Date.parse("2026-05-04T12:00:01.000Z");
    const snapshot = await service.checkLatestVersion();

    expect(fetchLatestVersion).toHaveBeenCalledTimes(2);
    expect(snapshot).toMatchObject({ latestVersion: "1.2.4", latestImageTag: "v1.2.4" });
  });

  test("uses saved GitHub token for release checks", async () => {
    /* Authenticated GitHub API calls avoid anonymous rate limits during runtime update checks. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-github-token-"));
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tag_name: "v1.2.3", target_commitish: "newsha", body: "Release notes" })
    } as Response);
    writeRuntimeEnv(runtimeDir);
    const service = new RuntimeUpdateService({ runtimeConfigDir: () => runtimeDir });
    (service as unknown as { githubApp: { getStoredToken: () => string } }).githubApp = { getStoredToken: () => "github_pat_example123" };

    await service.checkLatestVersion();

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/releases/latest"), {
      headers: expect.objectContaining({ Authorization: "Bearer github_pat_example123" })
    });
    fetchMock.mockRestore();
  });

  test("falls back to public latest release redirect when anonymous API is rate-limited", async () => {
    /* Public installs must update without GitHub credentials even when anonymous API quota is exhausted. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-github-rate-limit-"));
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({ location: "https://github.com/nyxandro/remote-vibe-station/releases/tag/v1.2.3" })
      } as Response);
    writeRuntimeEnv(runtimeDir);
    const service = new RuntimeUpdateService({ runtimeConfigDir: () => runtimeDir });

    const snapshot = await service.checkLatestVersion();

    expect(snapshot).toMatchObject({ latestVersion: "1.2.3", latestImageTag: "v1.2.3", updateAvailable: true });
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining("/releases/latest"), { redirect: "manual" });
    fetchMock.mockRestore();
  });

  test("uses host project directory for compose relative mounts", async () => {
    /* Docker daemon resolves bind-mount sources on the host, so compose must not use /runtime-config as project dir. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-host-dir-"));
    const runCommand = jest.fn().mockResolvedValue(undefined);
    writeRuntimeEnv(runtimeDir);
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
      runtimeHostConfigDir: () => "/opt/remote-vibe-station-runtime",
      fetchLatestVersion: jest.fn().mockResolvedValue({ version: "1.2.3", imageTag: "v1.2.3", commitSha: "newsha" }),
      runCommand
    });

    await service.updateToLatest();

    const composeArgs = runCommand.mock.calls.map(([, args]) => args as string[]);
    expect(composeArgs).toEqual(expect.arrayContaining([
      expect.arrayContaining(["--project-directory", "/opt/remote-vibe-station-runtime"])
    ]));
    expect(composeArgs[1]).toEqual(expect.arrayContaining(["--env-file", path.join(runtimeDir, ".env"), "-f", path.join(runtimeDir, "docker-compose.yml")]));
  });

  test("schedules backend restart in detached helper container", async () => {
    /* Backend cannot synchronously replace itself: Compose kills the caller before the new backend starts. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-detached-backend-"));
    const runCommand = jest.fn().mockResolvedValue(undefined);
    writeRuntimeEnv(runtimeDir);
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
      runtimeHostConfigDir: () => "/opt/remote-vibe-station-runtime",
      fetchLatestVersion: jest.fn().mockResolvedValue({ version: "1.2.3", imageTag: "v1.2.3", commitSha: "newsha" }),
      runCommand
    });

    await service.updateToLatest();

    const backendRestartArgs = runCommand.mock.calls[3][1] as string[];
    expect(backendRestartArgs).toEqual(expect.arrayContaining(["run", "-d", "--rm", "-v", "/var/run/docker.sock:/var/run/docker.sock", "-w", "/opt/remote-vibe-station-runtime"]));
    expect(backendRestartArgs.join(" ")).toContain("/opt/remote-vibe-station-runtime:/opt/remote-vibe-station-runtime");
    expect(backendRestartArgs.join(" ")).toContain(`/opt/remote-vibe-station-runtime:${runtimeDir}:ro`);
    expect(backendRestartArgs).toEqual(expect.arrayContaining(["ghcr.io/nyxandro/remote-vibe-station-backend:v1.2.3", "sh", "-lc"]));
    expect(backendRestartArgs.join(" ")).toContain("up' '-d' '--no-deps' 'backend'");
  });

  test("fails before pulling images when runtime disk space is too low", async () => {
    /* Low disk space should fail fast before Docker pull can corrupt runtime state with partial writes. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-disk-low-"));
    const runCommand = jest.fn().mockResolvedValue(undefined);
    const statfsMock = jest.spyOn(fs, "statfsSync").mockReturnValue({ bavail: 1, bsize: 1024 } as fs.StatsFs);
    writeRuntimeEnv(runtimeDir, "0.2.7");
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
      runtimeHostConfigDir: () => "/opt/remote-vibe-station-runtime",
      fetchLatestVersion: jest.fn().mockResolvedValue({ version: "0.2.8", imageTag: "v0.2.8", commitSha: "newsha" }),
      runCommand
    });

    await expect(service.updateToLatest()).rejects.toThrow("APP_RUNTIME_DISK_SPACE_LOW");

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenNthCalledWith(1, "sh", expect.arrayContaining(["-lc", expect.stringContaining("docker image rm")]), runtimeDir);
    expect(fs.readFileSync(path.join(runtimeDir, ".env"), "utf-8")).toContain("RVS_RUNTIME_VERSION=0.2.7");
  });

  test("prunes stale runtime images before pulling new images", async () => {
    /* Cleanup must keep target and rollback images, while deleting older RVS tags that fill the disk. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-image-cleanup-"));
    const runCommand = jest.fn().mockResolvedValue(undefined);
    writeRuntimeEnv(runtimeDir, "0.2.7");
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
      runtimeHostConfigDir: () => "/opt/remote-vibe-station-runtime",
      fetchLatestVersion: jest.fn().mockResolvedValue({ version: "0.2.9", imageTag: "v0.2.9", commitSha: "newsha" }),
      runCommand
    });

    await service.updateToLatest();

    expect(runCommand).toHaveBeenNthCalledWith(1, "sh", expect.arrayContaining(["-lc", expect.stringContaining("docker images --format")]), runtimeDir);
    const cleanupScript = (runCommand.mock.calls[0][1] as string[])[1];
    expect(cleanupScript).toContain("ghcr.io/nyxandro/remote-vibe-station-backend:v0.2.9");
    expect(cleanupScript).toContain("ghcr.io/nyxandro/remote-vibe-station-backend:0.2.7");
    expect(cleanupScript).toContain("docker image rm");
    expect(cleanupScript).toContain("APP_RUNTIME_IMAGE_CLEANUP_FAILED");
    expect(cleanupScript).toContain("image is being used");
    expect(runCommand).toHaveBeenNthCalledWith(2, "docker", expect.arrayContaining(["compose", "pull"]), runtimeDir);
  });

  test("recovers corrupted update state file", async () => {
    /* Earlier non-atomic writes could leave empty JSON on ENOSPC; Settings must recover and preserve evidence. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-corrupt-state-"));
    writeRuntimeEnv(runtimeDir, "0.2.7");
    fs.writeFileSync(path.join(runtimeDir, "runtime-update-state.json"), "", "utf-8");
    const service = new RuntimeUpdateService({ runtimeConfigDir: () => runtimeDir, fetchLatestVersion: jest.fn() });

    const state = await service.getUpdateState();

    expect(state).toMatchObject({ status: "failed", currentVersion: "0.2.7" });
    expect(state.error).toContain("APP_RUNTIME_UPDATE_STATE_CORRUPT");
    expect(fs.readdirSync(runtimeDir).some((entry) => entry.startsWith("runtime-update-state.json.corrupt-"))).toBe(true);
  });

  test("resolves host config directory from linux mountinfo", async () => {
    /* Bind mounts store the host subpath in the mountinfo root field, not in the filesystem source field. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-mountinfo-"));
    const mountInfoPath = path.join(runtimeDir, "mountinfo");
    fs.writeFileSync(
      mountInfoPath,
      `708 618 8:1 /opt/remote-vibe-station-runtime ${runtimeDir} rw,relatime - ext4 /dev/sda1 rw,discard,errors=remount-ro\n`,
      "utf-8"
    );
    writeRuntimeEnv(runtimeDir);
    const runCommand = jest.fn().mockResolvedValue(undefined);
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
      mountInfoPath: () => mountInfoPath,
      fetchLatestVersion: jest.fn().mockResolvedValue({ version: "1.2.3", imageTag: "v1.2.3", commitSha: "newsha" }),
      runCommand
    });

    await service.updateToLatest();

    expect(runCommand).toHaveBeenNthCalledWith(2, "docker", expect.arrayContaining(["--project-directory", "/opt/remote-vibe-station-runtime"]), runtimeDir);
  });

  test("recovers update state as completed after backend restart", async () => {
    /* Persisted state lets the Mini App show success after backend restarts during self-update. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-state-"));
    writeRuntimeEnv(runtimeDir, "1.2.3");
    fs.writeFileSync(path.join(runtimeDir, "runtime-update-state.json"), JSON.stringify({
      status: "restarting",
      targetVersion: "1.2.3",
      targetImageTag: "v1.2.3",
      startedAt: "2026-05-03T12:00:00.000Z",
      updatedAt: "2026-05-03T12:00:10.000Z",
      steps: []
    }), "utf-8");
    const service = new RuntimeUpdateService({ runtimeConfigDir: () => runtimeDir, fetchLatestVersion: jest.fn() });

    const state = await service.getUpdateState();

    expect(state).toMatchObject({ status: "completed", targetVersion: "1.2.3" });
  });

  test("keeps target env when compose fails after restart begins", async () => {
    /* Once compose starts recreating containers, restoring old .env can leave images and version state mixed. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-partial-restart-"));
    writeRuntimeEnv(runtimeDir, "0.2.2");
    const runCommand = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("APP_RUNTIME_COMMAND_FAILED: compose restart failed after recreating services"));
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
      runtimeHostConfigDir: () => "/opt/remote-vibe-station-runtime",
      fetchLatestVersion: jest.fn().mockResolvedValue({ version: "0.2.3", imageTag: "v0.2.3", commitSha: "newsha" }),
      runCommand
    });

    await expect(service.updateToLatest()).rejects.toThrow("compose restart failed");

    const env = fs.readFileSync(path.join(runtimeDir, ".env"), "utf-8");
    expect(env).toContain("RVS_RUNTIME_VERSION=0.2.3");
    expect(env).toContain("RVS_BOT_IMAGE=ghcr.io/nyxandro/remote-vibe-station-bot:v0.2.3");
  });

  test("reconciles whole compose stack after stale container restart failure", async () => {
    /* Docker can fail on old orphan names during grouped up; service-scoped retries should converge the stack. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-reconcile-"));
    writeRuntimeEnv(runtimeDir, "0.2.2");
    const staleContainerError = new Error("APP_RUNTIME_COMMAND_FAILED: Error response from daemon: No such container: stale-proxy");
    const runCommand = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(staleContainerError)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
      runtimeHostConfigDir: () => "/opt/remote-vibe-station-runtime",
      fetchLatestVersion: jest.fn().mockResolvedValue({ version: "0.2.3", imageTag: "v0.2.3", commitSha: "newsha" }),
      runCommand
    });

    const result = await service.updateToLatest();

    expect(result.applied).toBe(true);
    expect(runCommand).toHaveBeenNthCalledWith(4, "docker", expect.arrayContaining(["up", "-d", "--remove-orphans", "miniapp"]), runtimeDir);
    expect(runCommand).toHaveBeenNthCalledWith(5, "docker", expect.arrayContaining(["up", "-d", "--remove-orphans", "bot"]), runtimeDir);
    expect(runCommand).toHaveBeenNthCalledWith(6, "docker", expect.arrayContaining(["up", "-d", "--remove-orphans", "opencode"]), runtimeDir);
    expect(runCommand).toHaveBeenNthCalledWith(7, "docker", expect.arrayContaining(["up", "-d", "--remove-orphans", "cliproxy"]), runtimeDir);
    expect(runCommand).toHaveBeenNthCalledWith(8, "docker", expect.arrayContaining(["up", "-d", "--remove-orphans", "proxy"]), runtimeDir);
    expect(runCommand).toHaveBeenNthCalledWith(9, "docker", expect.arrayContaining(["run", "-d", "--rm", "ghcr.io/nyxandro/remote-vibe-station-backend:v0.2.3"]), runtimeDir);
  });

  test("rolls back by restoring previous env and applying compose", async () => {
    /* Rollback should use the exact saved .env.previous instead of trying to infer old tags. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-rollback-"));
    writeRuntimeEnv(runtimeDir, "v1.2.3");
    fs.writeFileSync(path.join(runtimeDir, ".env.previous"), "RVS_RUNTIME_VERSION=sha-old\nRVS_RUNTIME_COMMIT_SHA=oldsha\nRVS_BACKEND_IMAGE=old-backend\nRVS_MINIAPP_IMAGE=old-miniapp\nRVS_BOT_IMAGE=old-bot\nRVS_OPENCODE_IMAGE=old-opencode\n", "utf-8");
    const runCommand = jest.fn().mockResolvedValue(undefined);
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
      runtimeHostConfigDir: () => runtimeDir,
      fetchLatestVersion: jest.fn(),
      runCommand
    });

    const result = await service.rollback();
    const env = fs.readFileSync(path.join(runtimeDir, ".env"), "utf-8");

    expect(result.applied).toBe(true);
    expect(env).toContain("RVS_RUNTIME_VERSION=sha-old");
    expect(env).toContain("RVS_BACKEND_IMAGE=old-backend");
    expect(runCommand).toHaveBeenCalledTimes(2);
  });
});
