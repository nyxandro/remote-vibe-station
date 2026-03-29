/**
 * @fileoverview Per-project PTY terminals that execute inside the shared OpenCode runtime.
 *
 * Exports:
 * - ProjectTerminalService - Manages PTYs and buffered transcripts keyed by project slug.
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
const TERMINAL_BUFFER_CHAR_LIMIT = 20_000;
const INITIAL_SHELL_READY_TIMEOUT_MS = 100;

type TerminalSession = {
  proc: pty.IPty;
  buffer: string;
  ready: Promise<void>;
};

@Injectable()
export class ProjectTerminalService {
  private readonly terminals = new Map<string, TerminalSession>();
  private readonly pendingSessions = new Map<string, Promise<void>>();

  public constructor(private readonly events: EventsService) {}

  public async ensure(slug: string, cwd: string): Promise<void> {
    /*
     * Create a terminal only once per project.
     * Re-using the PTY keeps shell state (cd, exports) per project.
     */
    const existing = this.terminals.get(slug);
    if (existing) {
      await existing.ready;
      return;
    }

    /* Concurrent project-selection and terminal-hydration requests must share the same PTY bootstrap work. */
    const pending = this.pendingSessions.get(slug);
    if (pending) {
      await pending;
      return;
    }

    const sessionPromise = (async () => {
      const session = await this.createSession(slug, cwd);
      this.terminals.set(slug, session);
    })();
    this.pendingSessions.set(slug, sessionPromise);

    try {
      await sessionPromise;
    } finally {
      this.pendingSessions.delete(slug);
    }
  }

  private async createSession(slug: string, cwd: string): Promise<TerminalSession> {
    /* Resolve the runtime only once for this bootstrap path so later ensure callers can await one shared promise. */
    const containerName = await this.resolveOpenCodeContainerName();

    let markReady = () => {};
    const ready = new Promise<void>((resolve) => {
      /* Terminal readiness waits briefly for the initial shell prompt so the Mini App can hydrate it on first open. */
      markReady = () => resolve();
    });

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

    /* Cap readiness wait so project selection still succeeds even if bash delays prompt rendering. */
    const readyTimer = setTimeout(() => {
      markReady();
    }, INITIAL_SHELL_READY_TIMEOUT_MS);

    /* Keep both the PTY handle and its buffered transcript available for late-subscribing UI clients. */
    const session: TerminalSession = {
      proc,
      buffer: "",
      ready
    };

    proc.onData((data) => {
      /* Persist the recent transcript so the terminal tab can show the initial prompt before the first typed command. */
      session.buffer = (session.buffer + data).slice(-TERMINAL_BUFFER_CHAR_LIMIT);
      clearTimeout(readyTimer);
      markReady();

      /* Every PTY chunk is still broadcast live for already-connected Mini App sockets. */
      this.events.publish({
        type: "terminal.output",
        ts: new Date().toISOString(),
        data: { slug, chunk: data }
      });
    });

    await ready;
    return session;
  }

  public readSnapshot(slug: string): string {
    /* Snapshot reads must fail fast when a caller forgot to initialize the terminal first. */
    const session = this.terminals.get(slug);
    if (!session) {
      throw new Error(
        "APP_PROJECT_TERMINAL_NOT_INITIALIZED: Project terminal is not initialized. Reopen the terminal tab or select the project and retry."
      );
    }

    return session.buffer;
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
    const session = this.terminals.get(slug);
    if (!session) {
      throw new Error(`Terminal not initialized for project: ${slug}`);
    }

    session.proc.write(input);
  }
}
