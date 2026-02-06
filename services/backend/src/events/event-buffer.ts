/**
 * @fileoverview In-memory ring buffer for recent events.
 *
 * Exports:
 * - EventBuffer (L10) - Stores last N events for replay.
 */

import { EventEnvelope } from "./events.types";

export class EventBuffer {
  private readonly items: EventEnvelope[] = [];

  public constructor(private readonly maxSize: number) {}

  public push(event: EventEnvelope): void {
    /* Append and trim to max size. */
    this.items.push(event);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  public all(): EventEnvelope[] {
    /* Return a shallow copy for safe iteration. */
    return [...this.items];
  }
}
