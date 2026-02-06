/**
 * @fileoverview Event hub for publishing and replaying events.
 *
 * Exports:
 * - EventListener (L14) - Callback signature for event subscribers.
 * - EventsService (L17) - In-memory event broker with buffer.
 */

import { Injectable, Inject } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { EventBuffer } from "./event-buffer";
import { EventEnvelope } from "./events.types";

type EventListener = (event: EventEnvelope) => void;

@Injectable()
export class EventsService {
  private readonly buffer: EventBuffer;
  private readonly listeners = new Set<EventListener>();

  public constructor(@Inject(ConfigToken) config: AppConfig) {
    /* Initialize buffer with configured size. */
    this.buffer = new EventBuffer(config.eventBufferSize);
  }

  public publish(event: EventEnvelope): void {
    /* Persist and broadcast the event. */
    this.buffer.push(event);
    this.listeners.forEach((listener) => listener(event));
  }

  public replay(): EventEnvelope[] {
    /* Return buffered events for late subscribers. */
    return this.buffer.all();
  }

  public subscribe(listener: EventListener): () => void {
    /* Register listener and return an unsubscribe function. */
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
