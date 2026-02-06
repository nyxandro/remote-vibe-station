/**
 * @fileoverview Per-project PTY terminals.
 *
 * Exports:
 * - ProjectTerminalService (L21) - Manages PTYs keyed by project slug.
 */

import { Injectable } from "@nestjs/common";
import * as pty from "node-pty";

import { EventsService } from "../events/events.service";

const SHELL = "bash";

@Injectable()
export class ProjectTerminalService {
  private readonly terminals = new Map<string, pty.IPty>();

  public constructor(private readonly events: EventsService) {}

  public ensure(slug: string, cwd: string): void {
    /*
     * Create a terminal only once per project.
     * Re-using the PTY keeps shell state (cd, exports) per project.
     */
    if (this.terminals.has(slug)) {
      return;
    }

    const proc = pty.spawn(SHELL, [], { name: "xterm-color", cwd });
    proc.onData((data) => {
      this.events.publish({
        type: "terminal.output",
        ts: new Date().toISOString(),
        data: { slug, chunk: data }
      });
    });

    this.terminals.set(slug, proc);
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
