/**
 * @fileoverview Periodic command sync scheduler for Telegram menu.
 *
 * Exports:
 * - PeriodicTaskController (L15) - Stop handle for interval task.
 * - startPeriodicTask (L20) - Starts periodic async task with safe error hook.
 */

export type PeriodicTaskController = {
  stop: () => void;
};

type StartPeriodicTaskInput = {
  intervalMs: number;
  run: () => Promise<void> | void;
  onError?: (error: unknown) => void;
};

export const startPeriodicTask = (input: StartPeriodicTaskInput): PeriodicTaskController => {
  /* Keep one timer for repeated best-effort sync runs. */
  const timer = setInterval(() => {
    Promise.resolve(input.run()).catch((error) => {
      /*
       * Scheduler must never crash the process on task failure.
       * Caller decides how to log and whether to alert.
       */
      input.onError?.(error);
    });
  }, input.intervalMs);

  return {
    stop: () => {
      /* Idempotent cleanup for graceful shutdown. */
      clearInterval(timer);
    }
  };
};
