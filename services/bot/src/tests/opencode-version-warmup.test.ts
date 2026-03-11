/**
 * @fileoverview Tests for bounded startup OpenCode version warmup retries.
 *
 * Exports:
 * - none (Jest suite).
 */

import {
  OPENCODE_VERSION_WARMUP_DELAY_MS,
  OPENCODE_VERSION_WARMUP_MAX_ATTEMPTS,
  waitForOpenCodeVersionWarmup
} from "../opencode-version-warmup";

describe("waitForOpenCodeVersionWarmup", () => {
  test("returns immediately when the first attempt succeeds", async () => {
    /* Healthy startup should not add artificial delay when backend and OpenCode are already reachable. */
    const run = jest.fn(async () => undefined);
    const sleep = jest.fn(async () => undefined);

    await waitForOpenCodeVersionWarmup({ run, sleep });

    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("retries transient startup failures and eventually succeeds", async () => {
    /* Bot startup should tolerate a short backend boot race instead of logging a permanent false alarm. */
    const run = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED backend:3000"))
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED backend:3000"))
      .mockResolvedValueOnce(undefined);
    const sleep = jest.fn(async () => undefined);
    const onRetry = jest.fn();

    await waitForOpenCodeVersionWarmup({ run, sleep, onRetry });

    expect(run).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, OPENCODE_VERSION_WARMUP_DELAY_MS);
    expect(sleep).toHaveBeenNthCalledWith(2, OPENCODE_VERSION_WARMUP_DELAY_MS);
  });

  test("throws the final error after bounded retries are exhausted", async () => {
    /* Persistent startup failure must still surface loudly after the bounded retry budget is spent. */
    const error = new Error("connect ECONNREFUSED backend:3000");
    const run = jest.fn(async () => {
      throw error;
    });
    const sleep = jest.fn(async () => undefined);
    const onRetry = jest.fn();

    await expect(waitForOpenCodeVersionWarmup({ run, sleep, onRetry })).rejects.toThrow(error);

    expect(run).toHaveBeenCalledTimes(OPENCODE_VERSION_WARMUP_MAX_ATTEMPTS);
    expect(onRetry).toHaveBeenCalledTimes(OPENCODE_VERSION_WARMUP_MAX_ATTEMPTS - 1);
    expect(sleep).toHaveBeenCalledTimes(OPENCODE_VERSION_WARMUP_MAX_ATTEMPTS - 1);
  });
});
