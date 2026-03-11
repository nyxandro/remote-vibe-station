/**
 * @fileoverview Bounded startup warmup for backend OpenCode version cache.
 *
 * Exports:
 * - OPENCODE_VERSION_WARMUP_MAX_ATTEMPTS - Maximum warmup attempts during bot startup.
 * - OPENCODE_VERSION_WARMUP_DELAY_MS - Delay between startup warmup attempts.
 * - waitForOpenCodeVersionWarmup - Retries a transient startup warmup operation with logging hooks.
 */

export const OPENCODE_VERSION_WARMUP_MAX_ATTEMPTS = 5;
export const OPENCODE_VERSION_WARMUP_DELAY_MS = 3_000;

type WaitForOpenCodeVersionWarmupInput = {
  run: () => Promise<void>;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (input: { attempt: number; maxAttempts: number; error: unknown }) => void;
};

const defaultSleep = async (delayMs: number): Promise<void> => {
  /* Startup warmup retry should yield back to the event loop instead of spinning. */
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};

export const waitForOpenCodeVersionWarmup = async (
  input: WaitForOpenCodeVersionWarmupInput
): Promise<void> => {
  /* Boot-time version warmup is idempotent and allowed to retry because containers often start concurrently. */
  const sleep = input.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= OPENCODE_VERSION_WARMUP_MAX_ATTEMPTS; attempt += 1) {
    try {
      await input.run();
      return;
    } catch (error) {
      if (attempt >= OPENCODE_VERSION_WARMUP_MAX_ATTEMPTS) {
        throw error;
      }

      input.onRetry?.({
        attempt,
        maxAttempts: OPENCODE_VERSION_WARMUP_MAX_ATTEMPTS,
        error
      });
      await sleep(OPENCODE_VERSION_WARMUP_DELAY_MS);
    }
  }
};
