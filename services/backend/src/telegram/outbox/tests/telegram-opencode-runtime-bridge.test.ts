/**
 * @fileoverview Tests for TelegramOpenCodeRuntimeBridge bash progress replacement keys.
 *
 * Exports/constructs:
 * - makeBridge (L18) - Creates bridge with minimal mocked dependencies.
 * - describe("TelegramOpenCodeRuntimeBridge bash progress", L45) - Verifies stable replace key for dynamic updates.
 */

import { TelegramOpenCodeRuntimeBridge } from "../telegram-opencode-runtime-bridge.service";

const makeBridge = () => {
  /* Keep dependencies explicit and minimal for direct unit tests. */
  const config = {
    telegramBotToken: "token",
    telegramMiniappShortName: "miniapp",
    publicBaseUrl: "http://localhost:4173"
  } as any;

  const events = {
    subscribe: jest.fn()
  } as any;

  const routes = {
    resolve: jest.fn(() => ({ adminId: 10, directory: "/tmp/demo" }))
  } as any;

  const outbox = {
    enqueueProgressReplace: jest.fn(),
    enqueueThinkingControl: jest.fn(),
    enqueueStreamNotification: jest.fn()
  } as any;

  const diffPreviews = {
    create: jest.fn()
  } as any;

  return {
    bridge: new TelegramOpenCodeRuntimeBridge(config, events, routes, outbox, diffPreviews),
    outbox
  };
};

describe("TelegramOpenCodeRuntimeBridge bash progress", () => {
  it("skips noisy runtime probe commands", () => {
    /* Version probes like node -v create noise in Telegram and should be suppressed. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "part-probe",
        callID: "call-probe",
        sessionID: "session-noise",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "node -v" },
          metadata: { output: "v22.22.0" }
        }
      }
    });

    /* No replace-progress message should be enqueued for probe commands. */
    expect(outbox.enqueueProgressReplace).not.toHaveBeenCalled();
  });

  it("reuses one progressKey when callID changes for the same tool part", () => {
    /* Simulate runtime updates where callID is not stable across chunks. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "part-1",
        callID: "call-a",
        sessionID: "session-1",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "node count.js" },
          metadata: { output: "1" }
        }
      }
    });

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "part-1",
        callID: "call-b",
        sessionID: "session-1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "node count.js" },
          metadata: { output: "1\n2" }
        }
      }
    });

    /* Dynamic output must update existing Telegram message instead of sending a new one. */
    expect(outbox.enqueueProgressReplace).toHaveBeenCalledTimes(2);
    const firstCall = outbox.enqueueProgressReplace.mock.calls[0][0];
    const secondCall = outbox.enqueueProgressReplace.mock.calls[1][0];
    expect(firstCall.progressKey).toEqual(secondCall.progressKey);
  });

  it("reuses one progressKey when part id is missing", () => {
    /* Runtime payloads may omit part.id, so mapping must still remain stable. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        callID: "call-a",
        sessionID: "session-2",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "node count.js" },
          metadata: { output: "1" }
        }
      }
    });

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        callID: "call-b",
        sessionID: "session-2",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "node count.js" },
          metadata: { output: "1\n2" }
        }
      }
    });

    /* Even without part.id, updates should target one Telegram message. */
    expect(outbox.enqueueProgressReplace).toHaveBeenCalledTimes(2);
    const firstCall = outbox.enqueueProgressReplace.mock.calls[0][0];
    const secondCall = outbox.enqueueProgressReplace.mock.calls[1][0];
    expect(firstCall.progressKey).toEqual(secondCall.progressKey);
  });

  it("reuses one progressKey when part id changes between updates", () => {
    /* Some runtimes emit a new part.id per incremental chunk for one command. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "part-a",
        callID: "call-a",
        sessionID: "session-3",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "ls -la && node count.js" },
          metadata: { output: "1\n2" }
        }
      }
    });

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "part-b",
        callID: "call-b",
        sessionID: "session-3",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls -la && node count.js" },
          metadata: { output: "1\n2\n3" }
        }
      }
    });

    /* Progress updates must target one message despite part.id churn. */
    expect(outbox.enqueueProgressReplace).toHaveBeenCalledTimes(2);
    const firstCall = outbox.enqueueProgressReplace.mock.calls[0][0];
    const secondCall = outbox.enqueueProgressReplace.mock.calls[1][0];
    expect(firstCall.progressKey).toEqual(secondCall.progressKey);
  });
});
