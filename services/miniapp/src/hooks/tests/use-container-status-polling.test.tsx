/**
 * @fileoverview Tests for automatic container status polling hook.
 */

/* @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useContainerStatusPolling } from "../use-container-status-polling";

const POLL_INTERVAL_MS = 8000;

describe("useContainerStatusPolling", () => {
  it("runs immediate fetch and periodic polling for runnable project", () => {
    /* Polling starts only when a concrete runnable project is selected. */
    vi.useFakeTimers();
    const onPoll = vi.fn();

    renderHook(() =>
      useContainerStatusPolling({
        projectId: "tvoc",
        isRunnable: true,
        pollIntervalMs: POLL_INTERVAL_MS,
        onPoll
      })
    );

    expect(onPoll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(onPoll).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not poll when project is not runnable", () => {
    /* Non-runnable folders should not trigger status requests. */
    vi.useFakeTimers();
    const onPoll = vi.fn();

    renderHook(() =>
      useContainerStatusPolling({
        projectId: "manycodex",
        isRunnable: false,
        pollIntervalMs: POLL_INTERVAL_MS,
        onPoll
      })
    );

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 2);
    expect(onPoll).toHaveBeenCalledTimes(0);
    vi.useRealTimers();
  });
});
