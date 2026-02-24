/**
 * @fileoverview Runtime controls for OpenCode docker service.
 *
 * Exports:
 * - OpenCodeVersionStatus (L17) - Current/latest OpenCode versions with update marker.
 * - OpenCodeUpdateResult (L24) - Update operation result details.
 * - OpenCodeRuntimeService (L35) - Restarts, checks version, and updates OpenCode containers.
 */

import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";

export type OpenCodeVersionStatus = {
  currentVersion: string;
  latestVersion: string | null;
  latestCheckedAt: string | null;
  updateAvailable: boolean;
};

export type OpenCodeUpdateResult = {
  updated: boolean;
  restarted: string[];
  before: OpenCodeVersionStatus;
  after: OpenCodeVersionStatus;
};

const OPENCODE_SERVICE_LABEL = "label=com.docker.compose.service=opencode";
const OPENCODE_NPM_PACKAGE = "opencode-ai";
const VERSION_READ_MAX_ATTEMPTS = 20;
const VERSION_READ_RETRY_DELAY_MS = 1_000;

@Injectable()
export class OpenCodeRuntimeService {
  private latestVersionCache: { version: string; checkedAt: string } | null = null;

  public async restartServiceContainers(): Promise<{ restarted: string[] }> {
    /* Restart all compose containers labeled as service=opencode. */
    const names = await this.listOpenCodeContainerNames();

    for (const name of names) {
      await this.runDocker(["restart", name]);
    }

    return { restarted: names };
  }

  public async getVersionStatus(): Promise<OpenCodeVersionStatus> {
    /* Return current version and last known latest version for UI rendering. */
    const currentVersion = await this.readCurrentVersion();
    const latestVersion = this.latestVersionCache?.version ?? null;
    const latestCheckedAt = this.latestVersionCache?.checkedAt ?? null;

    return {
      currentVersion,
      latestVersion,
      latestCheckedAt,
      updateAvailable: Boolean(latestVersion && latestVersion !== currentVersion)
    };
  }

  public async checkVersionStatus(): Promise<OpenCodeVersionStatus> {
    /* Refresh latest version from npm registry and return full status snapshot. */
    const [currentVersion, latestVersion] = await Promise.all([
      this.readCurrentVersion(),
      this.readLatestPublishedVersion()
    ]);

    const checkedAt = new Date().toISOString();
    this.latestVersionCache = { version: latestVersion, checkedAt };

    return {
      currentVersion,
      latestVersion,
      latestCheckedAt: checkedAt,
      updateAvailable: latestVersion !== currentVersion
    };
  }

  public async updateToLatestVersion(): Promise<OpenCodeUpdateResult> {
    /* Install latest package in running container(s) and restart them. */
    const before = await this.checkVersionStatus();
    const latestVersion = before.latestVersion;

    if (!latestVersion) {
      throw new Error("Latest OpenCode version is unavailable");
    }

    if (!before.updateAvailable) {
      return {
        updated: false,
        restarted: [],
        before,
        after: before
      };
    }

    const names = await this.listOpenCodeContainerNames();
    for (const name of names) {
      await this.runDocker([
        "exec",
        name,
        "npm",
        "install",
        "-g",
        `${OPENCODE_NPM_PACKAGE}@${latestVersion}`
      ]);
    }

    for (const name of names) {
      await this.runDocker(["restart", name]);
    }

    const afterCurrentVersion = await this.readCurrentVersion({ containerNames: names });
    const after: OpenCodeVersionStatus = {
      currentVersion: afterCurrentVersion,
      latestVersion,
      latestCheckedAt: this.latestVersionCache?.checkedAt ?? new Date().toISOString(),
      updateAvailable: latestVersion !== afterCurrentVersion
    };

    return {
      updated: true,
      restarted: names,
      before,
      after
    };
  }

  private async listOpenCodeContainerNames(): Promise<string[]> {
    /* Resolve running OpenCode container names from compose labels. */
    const namesRaw = await this.runDocker([
      "ps",
      "--filter",
      OPENCODE_SERVICE_LABEL,
      "--format",
      "{{.Names}}"
    ]);

    const names = namesRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (names.length === 0) {
      throw new Error("OpenCode container is not running");
    }

    return names;
  }

  private async readCurrentVersion(input?: { containerNames?: string[] }): Promise<string> {
    /* Retry version read because container may still be restarting after update. */
    const names = input?.containerNames ?? (await this.listOpenCodeContainerNames());
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= VERSION_READ_MAX_ATTEMPTS; attempt += 1) {
      for (const name of names) {
        try {
          const output = await this.runDocker(["exec", name, "opencode", "--version"]);
          const parsed = this.extractSemver(output);
          if (parsed) {
            return parsed;
          }

          lastError = new Error(`Failed to parse OpenCode version from output: ${output.trim()}`);
        } catch (error) {
          lastError = error;
        }
      }

      if (attempt < VERSION_READ_MAX_ATTEMPTS) {
        await this.sleep(VERSION_READ_RETRY_DELAY_MS);
      }
    }

    const message = lastError instanceof Error ? lastError.message : "Unknown error";
    throw new Error(`Failed to read OpenCode version after restart: ${message}`);
  }

  private async readLatestPublishedVersion(): Promise<string> {
    /* Resolve latest npm package version to detect update availability. */
    const output = await this.runCommand("npm", ["view", OPENCODE_NPM_PACKAGE, "version", "--json"]);
    const trimmed = output.trim();
    const parsed = this.extractSemver(trimmed.replaceAll('"', ""));
    if (!parsed) {
      throw new Error(`Failed to parse latest OpenCode npm version: ${trimmed}`);
    }
    return parsed;
  }

  private extractSemver(input: string): string | null {
    /* Parse semver from raw command output that may include prefixes/suffixes. */
    const match = input.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
    return match ? match[0] : null;
  }

  private async runDocker(args: string[]): Promise<string> {
    /* Execute docker command and return stdout text. */
    return this.runCommand("docker", args);
  }

  private async runCommand(command: string, args: string[]): Promise<string> {
    /* Execute process command and return stdout text on success. */
    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if ((code ?? 1) !== 0) {
          const stderrText = stderr.trim();
          const stdoutText = stdout.trim();
          const diagnostics = [
            stderrText ? `stderr=${stderrText}` : null,
            stdoutText ? `stdout=${stdoutText}` : null
          ]
            .filter((item): item is string => Boolean(item))
            .join(" ");
          reject(new Error(`${command} ${args.join(" ")} failed${diagnostics ? `: ${diagnostics}` : ""}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  private async sleep(ms: number): Promise<void> {
    /* Explicit delay helper keeps retry flow readable and deterministic. */
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
