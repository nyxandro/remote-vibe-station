/**
 * @fileoverview Tests for OpenCode event payload formatting.
 */

import { formatOpenCodeSsePayload } from "../opencode-event-parser";

describe("formatOpenCodeSsePayload", () => {
  it("suppresses noisy message.updated payloads", () => {
    const raw = JSON.stringify({
      type: "message.updated",
      properties: {
        info: { role: "assistant" }
      }
    });

    expect(formatOpenCodeSsePayload(raw)).toBeNull();
  });

  it("suppresses session.status payloads", () => {
    const raw = JSON.stringify({
      type: "session.status",
      properties: { status: { type: "busy" } }
    });

    expect(formatOpenCodeSsePayload(raw)).toBeNull();
  });

  it("forwards delta-like events with text", () => {
    const raw = JSON.stringify({
      type: "message.delta",
      properties: { text: "hello" }
    });

    expect(formatOpenCodeSsePayload(raw)).toBe("hello");
  });
});
