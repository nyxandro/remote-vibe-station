/**
 * @fileoverview Per-project PTY terminals that execute inside the shared OpenCode runtime.
 *
 * Exports:
 * - ProjectTerminalService - Manages PTYs keyed by project slug.
 */

import { execFile } from "node:child_process";

import { Injectable } from "@nestjs/common";
import * as pty from "node-pty";

import { EventsService } from "../events/events.service";

const DOCKER_COMMAND = "docker";
const DOCKER_OPENCODE_SERVICE_FILTER = "label=com.docker.compose.service=opencode";
const DOCKER_NAME_FORMAT = "{{.Names}}";
const OPENCODE_TOOLBOX_PATH = "/toolbox/bin:/toolbox/npm-global/bin:/toolbox/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const DOCKER_DISCOVERY_TIMEOUT_MS = 5_000;

@Injectable()
export class ProjectTerminalService {
  private readonly terminals = new Map<string, pty.IPty>();

  public constructor(private readonly events: EventsService) {}

  public async ensure(slug: string, cwd: string): Promise<void> {
    /*
     * Create a terminal only once per project.
     * Re-using the PTY keeps shell state (cd, exports) per project.
     */
    if (this.terminals.has(slug)) {
      return;
    }

    /* Resolve the active OpenCode runtime container so terminal sessions see toolbox-installed CLIs. */
    const containerName = await this.resolveOpenCodeContainerName();

    /* Spawn an interactive docker exec session directly in the project worktree inside the OpenCode runtime. */
    const proc = pty.spawn(
      DOCKER_COMMAND,
      [
        "exec",
        "-it",
        "-w",
        cwd,
        "-e",
        `PATH=${OPENCODE_TOOLBOX_PATH}`,
        containerName,
        "bash"
      ],
      { name: "xterm-color", cwd }
    );
    proc.onData((data) => {
      this.events.publish({
        type: "terminal.output",
        ts: new Date().toISOString(),
        data: { slug, chunk: data }
      });
    });

    this.terminals.set(slug, proc);
  }

  private async resolveOpenCodeContainerName(): Promise<string> {
    /* Fail fast with an operator-actionable error when the shared runtime is unavailable. */
    const output = await this.readOpenCodeContainerNames();
    const containerName = output
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (!containerName) {
      throw new Error(
        "APP_OPENCODE_TERMINAL_UNAVAILABLE: OpenCode runtime container is not running. Start the opencode service and try again."
      );
    }

    return containerName;
  }

  private async readOpenCodeContainerNames(): Promise<string> {
    /* Bound docker discovery so one stuck CLI call does not freeze the backend event loop. */
    return new Promise((resolve, reject) => {
      execFile(
        DOCKER_COMMAND,
        ["ps", "--filter", DOCKER_OPENCODE_SERVICE_FILTER, "--format", DOCKER_NAME_FORMAT],
        { encoding: "utf-8", timeout: DOCKER_DISCOVERY_TIMEOUT_MS },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout);
        }
      );
    });
  }

  public sendInput(slug: string, input: string): void {
    /* Write user input to the project's PTY. */
    const proc = this.terminals.get(slug);
    if (!proc) {
      throw new Error(`Terminal not initialized for project: ${slug}`);
    }
    proc.write(input);
  }
}
