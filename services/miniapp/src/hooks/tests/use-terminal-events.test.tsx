/**
 * @fileoverview Tests for authenticated terminal event streaming hook.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTerminalEvents } from "../use-terminal-events";

vi.mock("../../api/client", () => ({
  getEventStreamUrl: vi.fn()
}));

type SocketInstance = {
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
  url: string;
};

const createdSockets: SocketInstance[] = [];

class FakeWebSocket {
  public static readonly OPEN = 1;
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
    const { getEventStreamUrl } = await import("../../api/client");
    vi.mocked(getEventStreamUrl).mockResolvedValue("ws://example.test/events?token=abc");

    const { result } = renderHook(() => useTerminalEvents("alpha"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(createdSockets).toHaveLength(1);
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
    const { getEventStreamUrl } = await import("../../api/client");
    vi.mocked(getEventStreamUrl)
      .mockResolvedValueOnce("ws://example.test/events?token=first")
      .mockResolvedValueOnce("ws://example.test/events?token=second");

    renderHook(() => useTerminalEvents("alpha"));
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
});
