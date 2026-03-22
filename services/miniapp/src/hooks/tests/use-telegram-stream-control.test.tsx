/**
 * @fileoverview Tests for Telegram stream control hook.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiPost } from "../../api/client";
import { useTelegramStreamControl } from "../use-telegram-stream-control";

vi.mock("../../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn()
}));

describe("useTelegramStreamControl", () => {
  beforeEach(() => {
    /* Reset request mocks so each test can define the exact status/start/stop contract it expects. */
    vi.clearAllMocks();
  });

  it("loads the current stream status when controls are allowed", async () => {
    /* Settings header should reflect backend stream state before the user presses start/stop buttons. */
    vi.mocked(apiGet).mockResolvedValueOnce({ streamEnabled: true });

    const { result } = renderHook(() => useTelegramStreamControl(vi.fn(), true));

    await act(async () => {
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledWith("/api/telegram/stream/status");
    expect(result.current.telegramStreamEnabled).toBe(true);
  });

  it("starts and stops the Telegram stream through backend commands", async () => {
    /* Hook should keep local UI state in sync after successful stream toggles. */
    vi.mocked(apiGet).mockResolvedValueOnce({ streamEnabled: false });
    vi.mocked(apiPost).mockResolvedValue({});
    const setError = vi.fn();

    const { result } = renderHook(() => useTelegramStreamControl(setError, true));

    await act(async () => {
      await Promise.resolve();
      await result.current.startTelegramChat();
      await result.current.endTelegramChat();
    });

    expect(apiPost).toHaveBeenNthCalledWith(1, "/api/telegram/stream/start", {});
    expect(apiPost).toHaveBeenNthCalledWith(2, "/api/telegram/stream/stop", {});
    expect(result.current.telegramStreamEnabled).toBe(false);
    expect(setError).toHaveBeenCalledWith(null);
  });
});
