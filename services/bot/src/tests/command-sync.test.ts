/**
 * @fileoverview Tests for periodic task scheduler.
 *
 * Exports:
 * - (none)
 */

import { startPeriodicTask } from "../command-sync";

describe("startPeriodicTask", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("runs task on each interval", async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const controller = startPeriodicTask({ intervalMs: 1000, run });

    jest.advanceTimersByTime(3000);
    await Promise.resolve();

    expect(run).toHaveBeenCalledTimes(3);
    controller.stop();
  });

  it("stops scheduling after stop", async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const controller = startPeriodicTask({ intervalMs: 1000, run });

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    controller.stop();

    jest.advanceTimersByTime(5000);
    await Promise.resolve();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("forwards task errors to onError callback", async () => {
    const run = jest.fn().mockRejectedValue(new Error("boom"));
    const onError = jest.fn();
    const controller = startPeriodicTask({ intervalMs: 1000, run, onError });

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
    controller.stop();
  });
});
