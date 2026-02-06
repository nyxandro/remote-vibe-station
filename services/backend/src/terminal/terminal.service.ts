/**
 * @fileoverview PTY-backed terminal service for Mini App.
 *
 * Exports:
 * - SHELL (L13) - Default shell command.
 * - TerminalService (L16) - Spawns a shell and streams output.
 */

import { Injectable } from "@nestjs/common";
import * as pty from "node-pty";

import { EventsService } from "../events/events.service";

const SHELL = "bash";

@Injectable()
export class TerminalService {
  private readonly ptyProcess: pty.IPty;

  public constructor(private readonly events: EventsService) {
    /* Spawn a shell and stream its output. */
    this.ptyProcess = pty.spawn(SHELL, [], { name: "xterm-color" });

    this.ptyProcess.onData((data) => {
      this.events.publish({
        type: "terminal.output",
        ts: new Date().toISOString(),
        data: { chunk: data }
      });
    });
  }

  public sendInput(input: string): void {
    /* Write input into the PTY process. */
    this.ptyProcess.write(input);
  }
}
