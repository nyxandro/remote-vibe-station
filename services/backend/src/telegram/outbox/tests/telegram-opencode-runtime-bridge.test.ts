/**
 * @fileoverview Tests for TelegramOpenCodeRuntimeBridge bash progress replacement keys.
 *
 * Exports/constructs:
 * - makeBridge (L18) - Creates bridge with minimal mocked dependencies.
 * - describe("TelegramOpenCodeRuntimeBridge bash progress", L45) - Verifies stable replace key for dynamic updates.
 */

import { TelegramOpenCodeRuntimeBridge } from "../telegram-opencode-runtime-bridge.service";

const makeBridge = () => {
  /* Keep dependencies explicit and minimal for direct unit tests. */
  const config = {
    telegramBotToken: "token",
    telegramMiniappShortName: "miniapp",
    publicBaseUrl: "http://localhost:4173"
  } as any;

  const events = {
    subscribe: jest.fn()
  } as any;

  const routes = {
    resolve: jest.fn(() => ({ adminId: 10, directory: "/tmp/demo" })),
    bindPermission: jest.fn(() => "perm-token")
  } as any;

  const outbox = {
    enqueueAssistantStreamDelta: jest.fn(),
    enqueueProgressReplace: jest.fn(),
    enqueueThinkingControl: jest.fn(),
    enqueueStreamNotification: jest.fn(),
    enqueueAdminNotification: jest.fn()
  } as any;

  const diffPreviews = {
    create: jest.fn()
  } as any;

  return {
    bridge: new TelegramOpenCodeRuntimeBridge(config, events, routes, outbox, diffPreviews),
    outbox
  };
};

describe("TelegramOpenCodeRuntimeBridge bash progress", () => {
  it("skips noisy runtime probe commands", () => {
    /* Version probes like node -v create noise in Telegram and should be suppressed. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "part-probe",
        callID: "call-probe",
        sessionID: "session-noise",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "node -v" },
          metadata: { output: "v22.22.0" }
        }
      }
    });

    /* No replace-progress message should be enqueued for probe commands. */
    expect(outbox.enqueueAssistantStreamDelta).not.toHaveBeenCalled();
  });

  it("reuses one progressKey when callID changes for the same tool part", () => {
    /* Simulate runtime updates where callID is not stable across chunks. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "part-1",
        callID: "call-a",
        sessionID: "session-1",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "node count.js" },
          metadata: { output: "1" }
        }
      }
    });

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "part-1",
        callID: "call-b",
        sessionID: "session-1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "node count.js" },
          metadata: { output: "1\n2" }
        }
      }
    });

    /* Dynamic output must update existing Telegram message instead of sending a new one. */
    expect(outbox.enqueueProgressReplace).toHaveBeenCalledTimes(2);
    const firstCall = outbox.enqueueProgressReplace.mock.calls[0][0];
    const secondCall = outbox.enqueueProgressReplace.mock.calls[1][0];
    expect(firstCall.progressKey).toEqual(secondCall.progressKey);
  });

  it("reuses one progressKey when part id is missing", () => {
    /* Runtime payloads may omit part.id, so mapping must still remain stable. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        callID: "call-a",
        sessionID: "session-2",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "node count.js" },
          metadata: { output: "1" }
        }
      }
    });

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        callID: "call-b",
        sessionID: "session-2",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "node count.js" },
          metadata: { output: "1\n2" }
        }
      }
    });

    /* Even without part.id, updates should target one Telegram message. */
    expect(outbox.enqueueProgressReplace).toHaveBeenCalledTimes(2);
    const firstCall = outbox.enqueueProgressReplace.mock.calls[0][0];
    const secondCall = outbox.enqueueProgressReplace.mock.calls[1][0];
    expect(firstCall.progressKey).toEqual(secondCall.progressKey);
  });

  it("reuses one progressKey when part id changes between updates", () => {
    /* Some runtimes emit a new part.id per incremental chunk for one command. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "part-a",
        callID: "call-a",
        sessionID: "session-3",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "ls -la && node count.js" },
          metadata: { output: "1\n2" }
        }
      }
    });

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "part-b",
        callID: "call-b",
        sessionID: "session-3",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls -la && node count.js" },
          metadata: { output: "1\n2\n3" }
        }
      }
    });

    /* Progress updates must target one message despite part.id churn. */
    expect(outbox.enqueueProgressReplace).toHaveBeenCalledTimes(2);
    const firstCall = outbox.enqueueProgressReplace.mock.calls[0][0];
    const secondCall = outbox.enqueueProgressReplace.mock.calls[1][0];
    expect(firstCall.progressKey).toEqual(secondCall.progressKey);
  });

  it("ignores raw text part updates to avoid echoing the user prompt", () => {
    /* Raw text parts are noisy and can mirror the user input instead of assistant output. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "text-1",
        sessionID: "session-text",
        text: "Привет"
      }
    });

    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "text-2",
        sessionID: "session-text",
        text: "Привет, мир"
      }
    });

    expect(outbox.enqueueProgressReplace).not.toHaveBeenCalled();
  });

  it("streams assistant text part deltas", () => {
    /* OpenCode emits final assistant text incrementally via message.part.delta on text parts. */
    const { bridge, outbox } = makeBridge();
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);

    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-1",
        sessionID: "session-delta"
      }
    });

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-delta",
            partID: "assistant-part-1",
            field: "text",
            delta: "Первая часть"
          }
        })
      }
    });

    nowSpy.mockReturnValue(2_600);

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-delta",
            partID: "assistant-part-1",
            field: "text",
            delta: " и вторая"
          }
        })
      }
    });

    expect(outbox.enqueueAssistantStreamDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-delta",
        text: "Первая часть"
      })
    );
    expect(outbox.enqueueAssistantStreamDelta).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: "session-delta",
        text: "Первая часть и вторая"
      })
    );
    nowSpy.mockRestore();
  });

  it("keeps one telegram progress message across assistant text parts in the same turn", () => {
    /* Real OpenCode streams can rotate text part ids mid-reply, so Telegram live preview must stay on one message. */
    const { bridge, outbox } = makeBridge();
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);

    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-1",
        sessionID: "session-split"
      }
    });
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-split",
            partID: "assistant-part-1",
            field: "text",
            delta: "Первое сообщение"
          }
        })
      }
    });

    nowSpy.mockReturnValue(2_600);

    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-2",
        sessionID: "session-split"
      }
    });
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-split",
            partID: "assistant-part-2",
            field: "text",
            delta: "Второе сообщение"
          }
        })
      }
    });

    expect(outbox.enqueueAssistantStreamDelta).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: "Первое сообщение",
        sessionId: "session-split"
      })
    );
    expect(outbox.enqueueAssistantStreamDelta).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        text: "Первое сообщениеВторое сообщение",
        sessionId: "session-split"
      })
    );
    nowSpy.mockRestore();
  });

  it("throttles frequent assistant text deltas", () => {
    /* Streaming updates should be coalesced so Telegram does not hit edit rate limits on every token burst. */
    const { bridge, outbox } = makeBridge();
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);

    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-throttle",
        sessionID: "session-throttle"
      }
    });

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-throttle",
            partID: "assistant-part-throttle",
            field: "text",
            delta: "Первая"
          }
        })
      }
    });

    nowSpy.mockReturnValue(1_200);
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-throttle",
            partID: "assistant-part-throttle",
            field: "text",
            delta: " вторая"
          }
        })
      }
    });

    expect(outbox.enqueueAssistantStreamDelta).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(2_500);
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-throttle",
            partID: "assistant-part-throttle",
            field: "text",
            delta: " третья"
          }
        })
      }
    });

    expect(outbox.enqueueAssistantStreamDelta).toHaveBeenCalledTimes(2);
    expect(outbox.enqueueAssistantStreamDelta).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "Первая вторая третья" })
    );
    nowSpy.mockRestore();
  });

  it("ignores non-text part deltas", () => {
    /* Reasoning deltas should not leak into Telegram final-answer streaming. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "reasoning",
        id: "reasoning-part-1",
        sessionID: "session-delta"
      }
    });

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-delta",
            partID: "reasoning-part-1",
            field: "text",
            delta: "скрытое рассуждение"
          }
        })
      }
    });

    expect(outbox.enqueueAssistantStreamDelta).not.toHaveBeenCalled();
  });

  it("forwards cooldown notices to Telegram admin notifications", () => {
    /* Provider cooldown messages are easy to miss in Telegram unless surfaced explicitly. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-cooldown",
        sessionID: "session-cooldown"
      }
    });

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-cooldown",
            partID: "assistant-part-cooldown",
            field: "text",
            delta: "All credentials for model gpt-5.4 are cooling down\nповтор через 38с - попытка №6"
          }
        })
      }
    });

    expect(outbox.enqueueAdminNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 10,
        text: expect.stringContaining("All credentials for model gpt-5.4 are cooling down")
      })
    );
  });

  it("forwards system reminder blocks only once per session", () => {
    /* System reminders should reach Telegram, but duplicate deltas must not spam the admin chat. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-reminder",
        sessionID: "session-reminder"
      }
    });

    const payload = {
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-reminder",
            partID: "assistant-part-reminder",
            field: "text",
            delta: "<system-reminder>\nYour operational mode has changed from plan to build.\n</system-reminder>"
          }
        })
      }
    };

    (bridge as any).onEvent(payload);
    (bridge as any).onEvent(payload);

    expect(outbox.enqueueAdminNotification).toHaveBeenCalledTimes(1);
    expect(outbox.enqueueAdminNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 10,
        text: expect.stringContaining("<system-reminder>")
      })
    );
  });

  it("sends permission approval request as Telegram inline keyboard", () => {
    /* Permission events must be actionable from Telegram without manual CLI access. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "permission.updated",
          properties: {
            id: "perm-1",
            sessionID: "session-1",
            title: "Allow file edit",
            metadata: { tool: "edit", path: "src/app.ts" },
            status: "pending"
          }
        })
      }
    });

    expect(outbox.enqueueProgressReplace).toHaveBeenCalledTimes(1);
    expect(outbox.enqueueProgressReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 10,
        progressKey: "permission:10:perm-1",
        replyMarkup: {
          inlineKeyboard: expect.arrayContaining([
            [expect.objectContaining({ callback_data: expect.stringContaining("perm|") })]
          ])
        }
      })
    );
  });

  it("handles permission event when type is provided by SSE eventName", () => {
    /* Some OpenCode events set event name but payload contains only properties object. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        eventName: "permission.updated",
        payload: JSON.stringify({
          id: "perm-2",
          sessionID: "session-1",
          title: "Allow write",
          metadata: { tool: "write", filepath: "README.md" },
          status: "pending"
        })
      }
    });

    expect(outbox.enqueueProgressReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        progressKey: "permission:10:perm-2",
        replyMarkup: expect.any(Object)
      })
    );
  });

  it("handles permission.asked event name from OpenCode runtime", () => {
    /* OpenCode emits permission.asked when tool waits for approval. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "permission.asked",
          properties: {
            id: "perm-3",
            sessionID: "session-1",
            title: "Allow editing .env",
            metadata: { tool: "edit", path: "/home/nyx/projects/arena/.env" },
            status: "pending"
          }
        })
      }
    });

    expect(outbox.enqueueProgressReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        progressKey: "permission:10:perm-3",
        text: expect.stringContaining("OpenCode запрашивает права")
      })
    );
  });

  it("handles permission.asked payload where properties.permission is a string", () => {
    /* OpenCode uses `permission: \"edit\"` string in runtime events; parser must not treat it as object. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "permission.asked",
          properties: {
            id: "per-raw-1",
            sessionID: "session-1",
            permission: "edit",
            patterns: ["home/nyx/projects/arena/.env"],
            metadata: { filepath: "/home/nyx/projects/arena/.env" }
          }
        })
      }
    });

    expect(outbox.enqueueProgressReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        progressKey: "permission:10:per-raw-1"
      })
    );
  });
});
