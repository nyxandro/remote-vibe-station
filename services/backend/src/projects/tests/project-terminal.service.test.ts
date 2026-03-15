/**
 * @fileoverview Tests for project terminal runtime selection.
 *
 * Exports:
 * - none.
 */

import type { IPty } from "node-pty";

import { ProjectTerminalService } from "../project-terminal.service";

jest.mock("node-pty", () => ({
  spawn: jest.fn()
}));

jest.mock("node:child_process", () => ({
  execFile: jest.fn()
}));

const pty = jest.requireMock("node-pty") as { spawn: jest.Mock };
const childProcess = jest.requireMock("node:child_process") as { execFile: jest.Mock };

describe("ProjectTerminalService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("spawns project terminal inside opencode runtime container with toolbox PATH", async () => {
    /* Project terminal must run in the shared agent runtime so toolbox-installed CLIs are available. */
    const onData = jest.fn();
    const write = jest.fn();
    pty.spawn.mockReturnValue({ onData, write } satisfies Partial<IPty>);
    childProcess.execFile.mockImplementation((command, args, options, callback) => {
      callback(null, "remote-vibe-station-opencode-1\n", "");
    });
    const events = { publish: jest.fn() };
    const service = new ProjectTerminalService(events as never);

    await service.ensure("auto-v-arendu", "/srv/projects/auto-v-arendu");

    expect(childProcess.execFile).toHaveBeenCalledWith(
      "docker",
      [
        "ps",
        "--filter",
        "label=com.docker.compose.service=opencode",
        "--format",
        "{{.Names}}"
      ],
      expect.objectContaining({ encoding: "utf-8", timeout: 5000 }),
      expect.any(Function)
    );
    expect(pty.spawn).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "exec",
        "-it",
        "-w",
        "/srv/projects/auto-v-arendu",
        "-e",
        "PATH=/toolbox/bin:/toolbox/npm-global/bin:/toolbox/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "remote-vibe-station-opencode-1",
        "bash"
      ]),
      expect.objectContaining({ name: "xterm-color" })
    );
  });

  test("reuses existing terminal per project without a second docker lookup", async () => {
    /* PTY reuse preserves shell state and avoids spawning duplicate interactive docker exec sessions. */
    const onData = jest.fn();
    const write = jest.fn();
    pty.spawn.mockReturnValue({ onData, write } satisfies Partial<IPty>);
    childProcess.execFile.mockImplementation((command, args, options, callback) => {
      callback(null, "remote-vibe-station-opencode-1\n", "");
    });
    const service = new ProjectTerminalService({ publish: jest.fn() } as never);

    await service.ensure("auto-v-arendu", "/srv/projects/auto-v-arendu");
    await service.ensure("auto-v-arendu", "/srv/projects/auto-v-arendu");

    expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    expect(pty.spawn).toHaveBeenCalledTimes(1);
  });
});
