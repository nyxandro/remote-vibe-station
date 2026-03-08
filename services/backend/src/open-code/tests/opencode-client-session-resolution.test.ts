/**
 * @fileoverview Tests for OpenCodeClient session resolution metadata.
 *
 * Exports:
 * - (none)
 */

import { OpenCodeClient } from "../opencode-client";

describe("OpenCodeClient session resolution metadata", () => {
  const baseConfig = {
    opencodeServerUrl: "http://opencode:4096",
    opencodeServerUsername: undefined,
    opencodeServerPassword: undefined,
    opencodeDefaultProviderId: undefined,
    opencodeDefaultModelId: undefined
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("marks first implicit session creation as auto-started", async () => {
    /* PromptService must know that the session was created automatically, not reused. */
    jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "session-1" })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            info: {
              id: "msg-1",
              sessionID: "session-1",
              providerID: "opencode",
              modelID: "big-pickle",
              mode: "primary",
              agent: "build",
              cost: 0,
              tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
            },
            parts: [{ type: "text", text: "ok" }]
          })
      } as Response);

    const resolvedSessions: Array<{ sessionID: string; isNew: boolean; reason: string }> = [];
    const client = new OpenCodeClient(baseConfig as never);

    await client.sendPrompt("hello", {
      directory: "/srv/projects/demo",
      model: { providerID: "opencode", modelID: "big-pickle" },
      agent: "build",
      onSessionResolved: (sessionID, resolution) => {
        resolvedSessions.push({
          sessionID,
          isNew: resolution.isNew,
          reason: resolution.reason
        });
      }
    });

    expect(resolvedSessions).toEqual([
      {
        sessionID: "session-1",
        isNew: true,
        reason: "missing"
      }
    ]);
  });

  it("marks rotated busy session as auto-started with busy reason", async () => {
    /* Telegram must notify when OpenCode silently rotates away from a stuck thread. */
    jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "session-1" })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            info: {
              id: "msg-1",
              sessionID: "session-1",
              providerID: "opencode",
              modelID: "big-pickle",
              mode: "primary",
              agent: "build",
              cost: 0,
              tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
            },
            parts: [{ type: "text", text: "ok-1" }]
          })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ "session-1": { type: "busy" } })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "true"
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "session-2" })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            info: {
              id: "msg-2",
              sessionID: "session-2",
              providerID: "opencode",
              modelID: "big-pickle",
              mode: "primary",
              agent: "build",
              cost: 0,
              tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
            },
            parts: [{ type: "text", text: "ok-2" }]
          })
      } as Response);

    const resolutions: Array<{ sessionID: string; isNew: boolean; reason: string }> = [];
    const client = new OpenCodeClient(baseConfig as never);

    await client.sendPrompt("first", {
      directory: "/srv/projects/demo",
      model: { providerID: "opencode", modelID: "big-pickle" },
      agent: "build"
    });

    await client.sendPrompt("second", {
      directory: "/srv/projects/demo",
      model: { providerID: "opencode", modelID: "big-pickle" },
      agent: "build",
      onSessionResolved: (sessionID, resolution) => {
        resolutions.push({
          sessionID,
          isNew: resolution.isNew,
          reason: resolution.reason
        });
      }
    });

    expect(resolutions).toEqual([
      {
        sessionID: "session-2",
        isNew: true,
        reason: "busy-rotated"
      }
    ]);
  });
});
