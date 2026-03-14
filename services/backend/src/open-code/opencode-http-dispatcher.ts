/**
 * @fileoverview Shared undici dispatcher settings for long-running OpenCode HTTP calls.
 *
 * Exports:
 * - OPENCODE_LONG_RUNNING_HEADERS_TIMEOUT_MS - Generous response-header timeout for long reasoning turns.
 * - OPENCODE_LONG_RUNNING_BODY_TIMEOUT_MS - Generous body timeout for slow streaming/finalization.
 * - buildOpenCodeLongRunningRequestInit - Attaches one reusable dispatcher to long-running fetch requests.
 */

import { Agent, Dispatcher } from "undici";

const MINUTE_MS = 60_000;

export const OPENCODE_LONG_RUNNING_HEADERS_TIMEOUT_MS = 30 * MINUTE_MS;
export const OPENCODE_LONG_RUNNING_BODY_TIMEOUT_MS = 30 * MINUTE_MS;

const longRunningDispatcher: Dispatcher = new Agent({
  /* Long OpenCode turns can spend several minutes thinking or waiting on terminal commands before headers appear. */
  headersTimeout: OPENCODE_LONG_RUNNING_HEADERS_TIMEOUT_MS,
  bodyTimeout: OPENCODE_LONG_RUNNING_BODY_TIMEOUT_MS
});

export const buildOpenCodeLongRunningRequestInit = (init: RequestInit): RequestInit & { dispatcher: Dispatcher } => ({
  ...init,
  /* Reuse one dispatcher so long-running prompt calls get relaxed timeouts without creating per-request agents. */
  dispatcher: longRunningDispatcher
});
