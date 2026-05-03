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
  test("checks latest release and updates runtime env with versioned image refs", async () => {
    /* Update must preserve rollback state and apply the same version tag to every RVS service image. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-update-"));
    writeRuntimeEnv(runtimeDir);
    const runCommand = jest.fn().mockResolvedValue(undefined);
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
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
    expect(runCommand).toHaveBeenNthCalledWith(1, "docker", expect.arrayContaining(["compose", "pull"]), runtimeDir);
    expect(runCommand).toHaveBeenNthCalledWith(2, "docker", expect.arrayContaining(["miniapp", "bot", "opencode", "cliproxy", "proxy"]), runtimeDir);
    expect(runCommand).toHaveBeenNthCalledWith(3, "docker", expect.arrayContaining(["backend"]), runtimeDir);
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, "runtime-update-state.json"), "utf-8"))).toMatchObject({ status: "restarting", targetVersion: "1.2.3" });
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

  test("rolls back by restoring previous env and applying compose", async () => {
    /* Rollback should use the exact saved .env.previous instead of trying to infer old tags. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-runtime-rollback-"));
    writeRuntimeEnv(runtimeDir, "v1.2.3");
    fs.writeFileSync(path.join(runtimeDir, ".env.previous"), "RVS_RUNTIME_VERSION=sha-old\nRVS_RUNTIME_COMMIT_SHA=oldsha\nRVS_BACKEND_IMAGE=old-backend\nRVS_MINIAPP_IMAGE=old-miniapp\nRVS_BOT_IMAGE=old-bot\nRVS_OPENCODE_IMAGE=old-opencode\n", "utf-8");
    const runCommand = jest.fn().mockResolvedValue(undefined);
    const service = new RuntimeUpdateService({
      runtimeConfigDir: () => runtimeDir,
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
