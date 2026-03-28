/**
 * @fileoverview Runtime service health and restart controls for Mini App dashboard.
 *
 * Exports:
 * - ManagedRuntimeServiceId - Supported runtime services shown in the dashboard.
 * - ManagedRuntimeServiceHealth - Normalized health level for one runtime service.
 * - ManagedRuntimeServiceSnapshot - Health payload for one runtime service card.
 * - RuntimeServicesSnapshot - Full dashboard payload with capture timestamp.
 * - RuntimeServicesService - Collects health state and restarts managed runtime services.
 */

import { Injectable, Optional } from "@nestjs/common";
import { spawn } from "node:child_process";

const DOCKER_SERVICE_LABEL_PREFIX = "label=com.docker.compose.service=";
const DOCKER_COMMAND_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 4_000;
const MILLISECONDS_IN_SECOND = 1_000;

export type ManagedRuntimeServiceId = "miniapp" | "bot" | "opencode" | "cliproxy";

export type ManagedRuntimeServiceHealth = "healthy" | "degraded" | "down";

type ManagedRuntimeServiceConfig = {
  id: ManagedRuntimeServiceId;
  label: string;
  probeUrl: string | null;
};

type DockerInspectState = {
  Status?: string;
  Running?: boolean;
  Restarting?: boolean;
  StartedAt?: string;
  Error?: string;
  Health?: {
    Status?: string;
    Log?: Array<{
      Output?: string;
    }>;
  };
};

type DockerInspectRecord = {
  Name?: string;
  State?: DockerInspectState;
};

type ServiceProbeResult = {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  errorCode: string | null;
};

type RuntimeServicesDeps = {
  now: () => number;
  runDocker: (args: string[]) => Promise<string>;
  probe: (url: string) => Promise<ServiceProbeResult>;
};

export type ManagedRuntimeServiceSnapshot = {
  id: ManagedRuntimeServiceId;
  label: string;
  composeService: ManagedRuntimeServiceId;
  containerName: string | null;
  containerStatus: string;
  health: ManagedRuntimeServiceHealth;
  healthcheckStatus: string | null;
  startedAt: string | null;
  uptimeSeconds: number | null;
  probeUrl: string | null;
  probe: ServiceProbeResult | null;
  message: string;
  actions: {
    canRestart: boolean;
  };
};

export type RuntimeServicesSnapshot = {
  capturedAt: string;
  services: ManagedRuntimeServiceSnapshot[];
};

const MANAGED_RUNTIME_SERVICES: ManagedRuntimeServiceConfig[] = [
  { id: "miniapp", label: "Mini App", probeUrl: "http://miniapp:4173/" },
  { id: "bot", label: "Telegram Bot", probeUrl: "http://bot:3001/" },
  { id: "opencode", label: "OpenCode", probeUrl: "http://opencode:4096/" },
  { id: "cliproxy", label: "CLIProxy", probeUrl: "http://cliproxy:8317/v1/models" }
];

@Injectable()
export class RuntimeServicesService {
  private readonly deps: RuntimeServicesDeps;

  public constructor(@Optional() deps?: Partial<RuntimeServicesDeps>) {
    /* Keep docker and HTTP integrations overridable so health logic stays fully unit-testable. */
    this.deps = {
      now: deps?.now ?? (() => Date.now()),
      runDocker: deps?.runDocker ?? ((args) => this.runDocker(args)),
      probe: deps?.probe ?? ((url) => this.probeUrl(url))
    };
  }

  public async getSnapshot(): Promise<RuntimeServicesSnapshot> {
    /* Collect each managed service independently so one broken probe never hides the rest of the dashboard. */
    const services = await Promise.all(MANAGED_RUNTIME_SERVICES.map((service) => this.inspectService(service)));

    return {
      capturedAt: new Date(this.deps.now()).toISOString(),
      services
    };
  }

  public async restartService(serviceId: ManagedRuntimeServiceId): Promise<{ restarted: string[] }> {
    /* Restart every container that belongs to the requested compose service. */
    const containerNames = await this.listContainerNames(serviceId);
    if (containerNames.length === 0) {
      throw new Error(
        `APP_RUNTIME_SERVICE_NOT_FOUND: Cannot restart service '${serviceId}' because no matching container exists. Create or restore the runtime container and retry.`
      );
    }

    for (const containerName of containerNames) {
      await this.deps.runDocker(["restart", containerName]);
    }

    return { restarted: containerNames };
  }

  public isManagedServiceId(value: string): value is ManagedRuntimeServiceId {
    /* Controller input validation stays centralized so route params cannot drift from service config. */
    return MANAGED_RUNTIME_SERVICES.some((service) => service.id === value);
  }

  private async inspectService(config: ManagedRuntimeServiceConfig): Promise<ManagedRuntimeServiceSnapshot> {
    /* Missing containers should render explicit down state instead of failing the whole response. */
    const containerNames = await this.listContainerNames(config.id);
    if (containerNames.length === 0) {
      return {
        id: config.id,
        label: config.label,
        composeService: config.id,
        containerName: null,
        containerStatus: "missing",
        health: "down",
        healthcheckStatus: null,
        startedAt: null,
        uptimeSeconds: null,
        probeUrl: config.probeUrl,
        probe: null,
        message: "Container is not running.",
        actions: {
          canRestart: false
        }
      };
    }

    /* Prefer the first listed container because each managed service currently runs as a singleton. */
    const inspectPayload = await this.deps.runDocker(["inspect", ...containerNames]);
    const records = this.parseInspectPayload(inspectPayload);
    const record = records[0];
    const state = record?.State ?? {};
    const containerStatus = state.Status ?? "unknown";
    const healthcheckStatus = state.Health?.Status ?? null;
    const startedAt = this.normalizeStartedAt(state.StartedAt);
    const uptimeSeconds = this.calculateUptimeSeconds(startedAt, state.Running === true);

    /* Probes are lightweight and only run for containers that claim to be running. */
    const probe = config.probeUrl && state.Running ? await this.deps.probe(config.probeUrl) : null;
    const health = this.resolveHealth({ state, probe });

    return {
      id: config.id,
      label: config.label,
      composeService: config.id,
      containerName: this.normalizeContainerName(record?.Name),
      containerStatus,
      health,
      healthcheckStatus,
      startedAt,
      uptimeSeconds,
      probeUrl: config.probeUrl,
      probe,
      message: this.resolveMessage({ state, probe, containerStatus, healthcheckStatus }),
      actions: {
        canRestart: true
      }
    };
  }

  private async listContainerNames(serviceId: ManagedRuntimeServiceId): Promise<string[]> {
    /* Filter by compose-service label so container lookup works across different project names. */
    const output = await this.deps.runDocker([
      "ps",
      "-a",
      "--filter",
      `${DOCKER_SERVICE_LABEL_PREFIX}${serviceId}`,
      "--format",
      "{{.Names}}"
    ]);

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .sort();
  }

  private parseInspectPayload(payload: string): DockerInspectRecord[] {
    /* docker inspect always returns JSON array; fail fast if output becomes malformed. */
    try {
      const parsed = JSON.parse(payload) as DockerInspectRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `APP_RUNTIME_SERVICE_INSPECT_FAILED: Failed to parse docker inspect output for runtime services. Retry after checking Docker state. Details: ${message}`
      );
    }
  }

  private normalizeContainerName(name: string | undefined): string | null {
    /* docker inspect prefixes names with '/', which is noise for Mini App display. */
    if (!name) {
      return null;
    }

    return name.startsWith("/") ? name.slice(1) : name;
  }

  private normalizeStartedAt(value: string | undefined): string | null {
    /* Docker uses zero timestamps for never-started containers; expose null instead of fake dates. */
    if (!value || value.startsWith("0001-01-01")) {
      return null;
    }

    return value;
  }

  private calculateUptimeSeconds(startedAt: string | null, isRunning: boolean): number | null {
    /* Uptime is meaningful only for running containers with a valid start timestamp. */
    if (!isRunning || !startedAt) {
      return null;
    }

    const startedAtMs = Date.parse(startedAt);
    if (Number.isNaN(startedAtMs)) {
      return null;
    }

    return Math.max(0, Math.floor((this.deps.now() - startedAtMs) / MILLISECONDS_IN_SECOND));
  }

  private resolveHealth(input: { state: DockerInspectState; probe: ServiceProbeResult | null }): ManagedRuntimeServiceHealth {
    /* Running state, Docker healthchecks and live probes are combined into one operator-friendly status. */
    if (!input.state.Running || input.state.Status === "exited" || input.state.Status === "dead") {
      return "down";
    }

    if (input.state.Health?.Status === "unhealthy") {
      return "down";
    }

    if (input.state.Restarting || input.state.Health?.Status === "starting") {
      return "degraded";
    }

    if (input.probe && !input.probe.ok) {
      return "degraded";
    }

    return "healthy";
  }

  private resolveMessage(input: {
    state: DockerInspectState;
    probe: ServiceProbeResult | null;
    containerStatus: string;
    healthcheckStatus: string | null;
  }): string {
    /* Prefer the most actionable diagnostics string available for the operator modal. */
    const stateError = input.state.Error?.trim();
    if (!input.state.Running) {
      return stateError || `Container is ${input.containerStatus}.`;
    }

    if (input.healthcheckStatus === "unhealthy") {
      return this.extractHealthLogMessage(input.state) || "Docker healthcheck is failing.";
    }

    if (input.healthcheckStatus === "starting") {
      return "Service is starting and healthcheck is still warming up.";
    }

    if (input.state.Restarting) {
      return "Container is restarting.";
    }

    if (input.probe && !input.probe.ok) {
      const suffix = input.probe.statusCode ? `HTTP ${input.probe.statusCode}` : input.probe.errorCode ?? "probe failed";
      return `Service is running, but the live probe failed: ${suffix}.`;
    }

    return "Service is responding normally.";
  }

  private extractHealthLogMessage(state: DockerInspectState): string | null {
    /* Docker health logs often contain the clearest last-failure message for operators. */
    const lastLog = state.Health?.Log?.at(-1)?.Output?.trim() ?? "";
    return lastLog.length > 0 ? lastLog : null;
  }

  private async runDocker(args: string[]): Promise<string> {
    /* Execute plain docker commands because these services live in the shared runtime stack. */
    return new Promise((resolve, reject) => {
      const child = spawn("docker", args);
      let stdout = "";
      let stderr = "";
      let settled = false;

      /* Bound docker calls so a wedged daemon cannot freeze the dashboard or restart endpoint forever. */
      const timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill();
        reject(
          new Error(
            `APP_RUNTIME_SERVICE_COMMAND_TIMEOUT: docker ${args.join(" ")} timed out after ${DOCKER_COMMAND_TIMEOUT_MS}ms. Inspect Docker daemon/runtime health and retry.`
          )
        );
      }, DOCKER_COMMAND_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        if ((code ?? 1) !== 0) {
          const stderrText = stderr.trim();
          reject(
            new Error(
              `APP_RUNTIME_SERVICE_COMMAND_FAILED: docker ${args.join(" ")} failed. Inspect Docker daemon/runtime and retry.${stderrText ? ` Details: ${stderrText}` : ""}`
            )
          );
          return;
        }

        resolve(stdout);
      });
    });
  }

  private async probeUrl(url: string): Promise<ServiceProbeResult> {
    /* Probes fail soft into payload data instead of throwing so one hung service still yields a dashboard. */
    const startedAtMs = this.deps.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "manual"
      });

      return {
        ok: response.status < 500,
        statusCode: response.status,
        latencyMs: this.deps.now() - startedAtMs,
        errorCode: null
      };
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : "UNKNOWN_ERROR";
      return {
        ok: false,
        statusCode: null,
        latencyMs: this.deps.now() - startedAtMs,
        errorCode
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
