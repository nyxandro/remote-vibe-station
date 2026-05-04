/**
 * @fileoverview Docker Compose application helpers for runtime self-updates.
 *
 * Exports:
 * - RuntimeComposeUpdateInput - Dependencies required to apply a runtime Compose update.
 * - buildRuntimeComposeArgs - Builds Docker Compose args with host project directory semantics.
 * - applyRuntimeComposeUpdate - Reconciles non-backend services and schedules backend self-restart safely.
 */

import * as path from "node:path";

const BACKEND_SERVICE = "backend";
const NON_BACKEND_RUNTIME_SERVICES = ["miniapp", "bot", "opencode", "cliproxy", "proxy"];
const RUNTIME_ENV_FILE = ".env";
const STALE_CONTAINER_ERROR_MARKER = "No such container:";

export type RuntimeComposeUpdateInput = {
  runtimeDir: string;
  runtimeHostDir: string;
  backendImage: string;
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>;
};

export async function applyRuntimeComposeUpdate(input: RuntimeComposeUpdateInput): Promise<void> {
  /* Non-backend services can be reconciled synchronously because they do not kill the caller. */
  const args = buildRuntimeComposeArgs(input.runtimeDir, input.runtimeHostDir);
  try {
    await input.runCommand("docker", ["compose", ...args, "up", "-d", "--remove-orphans", ...NON_BACKEND_RUNTIME_SERVICES], input.runtimeDir);
  } catch (error) {
    if (!isStaleContainerError(error)) {
      throw error;
    }

    await reconcileNonBackendRuntimeServices(input, args);
  }

  await scheduleBackendSelfRestart(input, args);
}

export function buildRuntimeComposeArgs(runtimeDir: string, runtimeHostDir: string): string[] {
  /* Docker daemon resolves relative bind mounts on the host, so project dir must be the host path. */
  return [
    "--project-directory",
    runtimeHostDir,
    "--env-file",
    path.join(runtimeDir, RUNTIME_ENV_FILE),
    "-f",
    path.join(runtimeDir, "docker-compose.yml"),
    "-f",
    path.join(runtimeDir, "docker-compose.vless.yml")
  ];
}

async function reconcileNonBackendRuntimeServices(input: RuntimeComposeUpdateInput, args: string[]): Promise<void> {
  /* Service-scoped retries avoid restarting backend before the public edge is converged. */
  for (const service of NON_BACKEND_RUNTIME_SERVICES) {
    await input.runCommand("docker", ["compose", ...args, "up", "-d", "--remove-orphans", service], input.runtimeDir);
  }
}

async function scheduleBackendSelfRestart(input: RuntimeComposeUpdateInput, args: string[]): Promise<void> {
  /* A detached helper survives the current backend being killed by Compose during self-replacement. */
  const helperName = `rvs-backend-restart-${Date.now()}`;
  const script = [
    "sleep 2",
    ["docker", "compose", ...args, "up", "-d", "--no-deps", BACKEND_SERVICE].map(shellQuote).join(" ")
  ].join(" && ");

  await input.runCommand("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    helperName,
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    ...buildHelperRuntimeVolumeArgs(input.runtimeHostDir, input.runtimeDir),
    "-w",
    input.runtimeHostDir,
    input.backendImage,
    "sh",
    "-lc",
    script
  ], input.runtimeDir);
}

function buildHelperRuntimeVolumeArgs(runtimeHostDir: string, runtimeDir: string): string[] {
  /* Helper needs host-path project dir for bind mounts and container-path compose files from generated args. */
  const volumes = ["-v", `${runtimeHostDir}:${runtimeHostDir}`];
  if (runtimeDir !== runtimeHostDir) {
    volumes.push("-v", `${runtimeHostDir}:${runtimeDir}:ro`);
  }
  return volumes;
}

function isStaleContainerError(error: unknown): boolean {
  /* Docker may report stale container ids/names after earlier interrupted compose updates. */
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(STALE_CONTAINER_ERROR_MARKER);
}

function shellQuote(value: string): string {
  /* The helper command is executed by sh -lc, so every generated argument must be shell-safe. */
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
