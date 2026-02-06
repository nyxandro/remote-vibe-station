/**
 * @fileoverview Shared event envelope types.
 *
 * Exports:
 * - EventEnvelope (L9) - Standard event payload shape for WS.
 */

export type EventEnvelope<T = unknown> = {
  type: string;
  ts: string;
  requestId?: string;
  data: T;
};
