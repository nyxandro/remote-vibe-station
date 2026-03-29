/**
 * @fileoverview Tests for authenticated terminal event streaming hook.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTerminalEvents } from "../use-terminal-events";

vi.mock("../../api/client", () => ({
  apiGet: vi.fn(),
  getEventStreamUrl: vi.fn()
}));

type SocketInstance = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
  url: string;
};

const createdSockets: SocketInstance[] = [];

class FakeWebSocket {
  public static readonly OPEN = 1;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public readonly close = vi.fn();
  public readonly readyState = FakeWebSocket.OPEN;

  public constructor(public readonly url: string) {
    createdSockets.push(this);
  }
}

describe("useTerminalEvents", () => {
  beforeEach(() => {
    /* Each test resets created socket state so reconnect assertions stay deterministic. */
    createdSockets.length = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    /* Restore timers and globals so this hook suite cannot leak fake WebSocket state into other tests. */
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("does not connect when no active project is selected", () => {
    /* Hook must stay idle until terminal scope can be bound to a concrete project slug. */
    renderHook(() => useTerminalEvents(null));

    expect(createdSockets).toHaveLength(0);
  });

  it("buffers authenticated terminal output for the active project", async () => {
    /* Terminal stream should request a signed WS url before opening the socket. */
    const { apiGet, getEventStreamUrl } = await import("../../api/client");
    vi.mocked(apiGet).mockResolvedValue({ buffer: "user@host:~$ " });
    vi.mocked(getEventStreamUrl).mockResolvedValue("ws://example.test/events?token=abc");

    const { result } = renderHook(() => useTerminalEvents("alpha"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(createdSockets).toHaveLength(1);
    act(() => {
      createdSockets[0]?.onopen?.();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.terminalBuffer).toContain("user@host:~$");

    act(() => {
      createdSockets[0]?.onmessage?.({
        data: JSON.stringify({
          type: "terminal.output",
          data: { slug: "alpha", chunk: "pwd\n" }
        })
      });
    });

    expect(result.current.terminalBuffer).toContain("pwd");
  });

  it("reconnects after websocket close", async () => {
    /* Temporary backend restarts should not leave the terminal permanently disconnected. */
    const { apiGet, getEventStreamUrl } = await import("../../api/client");
    vi.mocked(apiGet).mockResolvedValue({ buffer: "" });
    vi.mocked(getEventStreamUrl)
      .mockResolvedValueOnce("ws://example.test/events?token=first")
      .mockResolvedValueOnce("ws://example.test/events?token=second");

    renderHook(() => useTerminalEvents("alpha"));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      createdSockets[0]?.onopen?.();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      createdSockets[0]?.onclose?.();
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(createdSockets).toHaveLength(2);
    expect(createdSockets[1]?.url).toContain("token=second");
  });

  it("merges the initial snapshot with live chunks that arrive during hydration", async () => {
    /* Snapshot hydration should not wipe the first live chunk when the socket opens before the HTTP transcript resolves. */
    const { apiGet, getEventStreamUrl } = await import("../../api/client");
    let resolveSnapshot: ((value: { buffer: string }) => void) | null = null;
    vi.mocked(apiGet).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve;
        })
    );
    vi.mocked(getEventStreamUrl).mockResolvedValue("ws://example.test/events?token=abc");

    const { result } = renderHook(() => useTerminalEvents("alpha"));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      createdSockets[0]?.onopen?.();
      createdSockets[0]?.onmessage?.({
        data: JSON.stringify({
          type: "terminal.output",
          data: { slug: "alpha", chunk: "ls -la\n" }
        })
      });
    });

    if (!resolveSnapshot) {
      throw new Error("snapshot promise was not created");
    }

    await act(async () => {
      resolveSnapshot?.({ buffer: "user@host:~$ pwd\n" });
      await Promise.resolve();
    });

    expect(result.current.terminalBuffer).toBe("user@host:~$ pwd\nls -la\n");
  });

  it("does not request the terminal snapshot twice while hydration is already in flight", async () => {
    /* Reconnect/open races should share one hydration request so buffered live chunks cannot be merged against stale parallel responses. */
    const { apiGet, getEventStreamUrl } = await import("../../api/client");
    vi.mocked(apiGet).mockImplementation(() => new Promise(() => {}));
    vi.mocked(getEventStreamUrl).mockResolvedValue("ws://example.test/events?token=abc");

    renderHook(() => useTerminalEvents("alpha"));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      createdSockets[0]?.onopen?.();
      createdSockets[0]?.onopen?.();
    });

    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
