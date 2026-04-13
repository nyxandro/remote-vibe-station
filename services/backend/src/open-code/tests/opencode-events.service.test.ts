/**
 * @fileoverview Tests for OpenCodeEventsService SSE parsing edge-cases.
 *
 * Exports:
 * - none (Jest suite).
 */

import { EventsService } from "../../events/events.service";
import { OpenCodeEventsService } from "../opencode-events.service";

describe("OpenCodeEventsService", () => {
  test("publishes the buffered SSE tail when the stream ends without a trailing blank line", () => {
    /* Some reconnect paths close mid-frame, but the last fully buffered event still must be delivered. */
    const config = {
      eventBufferSize: 10,
      opencodeServerUrl: "http://localhost"
    } as any;
    const events = new EventsService(config);
    const service = new OpenCodeEventsService(config, events);

    (service as any).publishEvent = jest.fn((eventName: string, dataLines: string[], directory: string) => {
      events.publish({
        type: "opencode.event",
        ts: new Date().toISOString(),
        data: { eventName, payload: dataLines.join("\n"), directory }
      });
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: message.part.delta\ndata: {"type":"message.part.delta","properties":{"sessionID":"tail-session"}}')
        );
        controller.close();
      }
    });

    return (service as any).readStream(stream, "/tmp/demo").then(() => {
      const published = events.replay();
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({
        type: "opencode.event",
        data: {
          eventName: "message.part.delta",
          directory: "/tmp/demo"
        }
      });
    });
  });
});
