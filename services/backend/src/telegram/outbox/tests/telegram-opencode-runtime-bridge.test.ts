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
    bindQuestion: jest.fn(() => "question-token"),
    bindPermission: jest.fn(() => "perm-token")
  } as any;

  const outbox = {
    enqueueAssistantStreamDelta: jest.fn(),
    enqueueAssistantCommentary: jest.fn(),
    enqueueProgressReplace: jest.fn(),
    enqueueThinkingControl: jest.fn(),
    enqueueStreamNotification: jest.fn(),
    enqueueAdminNotification: jest.fn(),
    closeAssistantProgress: jest.fn()
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

  it("buffers assistant text part deltas until the text block boundary", () => {
    /* Plain assistant text should not emit partial Telegram messages before the block is finished. */
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

    expect(outbox.enqueueAssistantStreamDelta).not.toHaveBeenCalled();
    expect(outbox.enqueueAssistantCommentary).not.toHaveBeenCalled();
    expect((bridge as any).assistantTextBySession.get("session-delta")).toBe("Первая часть и вторая");
    nowSpy.mockRestore();
  });

  it("keeps closed text-part replay protection across long-lived sessions", () => {
    /* Old commentary chunks must stay ignored even when the same session continues hours later. */
    const { bridge, outbox } = makeBridge();
    const nowSpy = jest.spyOn(Date, "now");

    nowSpy.mockReturnValue(1_000);
    (bridge as any).onEvent({
      type: "opencode.turn.started",
      ts: new Date().toISOString(),
      data: { sessionId: "session-text-replay" }
    });
    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-old",
        sessionID: "session-text-replay"
      }
    });
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-text-replay",
            partID: "assistant-part-old",
            field: "text",
            delta: "Старый комментарий"
          }
        })
      }
    });
    bridge.finalizeAssistantReply("session-text-replay");

    nowSpy.mockReturnValue(6 * 60 * 60 * 1000);
    (bridge as any).onEvent({
      type: "opencode.turn.started",
      ts: new Date().toISOString(),
      data: { sessionId: "session-text-replay" }
    });
    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-old",
        sessionID: "session-text-replay"
      }
    });
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-text-replay",
            partID: "assistant-part-old",
            field: "text",
            delta: "Старый комментарий"
          }
        })
      }
    });

    expect(outbox.enqueueAssistantCommentary).not.toHaveBeenCalled();
    expect((bridge as any).assistantTextBySession.get("session-text-replay")).toBeUndefined();
    nowSpy.mockRestore();
  });

  it("keeps one buffered transcript across assistant text parts in the same turn", () => {
    /* Real OpenCode streams can rotate text part ids mid-reply, so final buffered text must stay continuous. */
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

    expect(outbox.enqueueAssistantStreamDelta).not.toHaveBeenCalled();
    expect(outbox.enqueueAssistantCommentary).not.toHaveBeenCalled();
    expect((bridge as any).assistantTextBySession.get("session-split")).toBe("Первое сообщениеВторое сообщение");
    nowSpy.mockRestore();
  });

  it("sends a fresh Telegram message for text before and after tool activity", () => {
    /* Distinct assistant updates around tool execution must become separate chat messages. */
    const { bridge, outbox } = makeBridge();
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);

    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-1",
        sessionID: "session-separated"
      }
    });
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-separated",
            partID: "assistant-part-1",
            field: "text",
            delta: "Понял задачу."
          }
        })
      }
    });

    (bridge as any).handlePartUpdated({
      part: {
        type: "tool",
        id: "tool-part-1",
        tool: "bash",
        sessionID: "session-separated",
        state: {
          status: "running",
          input: { command: "npm test" },
          metadata: { output: "running" }
        }
      }
    });

    nowSpy.mockReturnValue(2_600);
    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-2",
        sessionID: "session-separated"
      }
    });
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-separated",
            partID: "assistant-part-2",
            field: "text",
            delta: "Нашел проблему в compose."
          }
        })
      }
    });

    expect(outbox.closeAssistantProgress).toHaveBeenCalledWith({ sessionId: "session-separated" });
    expect(outbox.enqueueAssistantCommentary).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        adminId: 10,
        text: "Понял задачу."
      })
    );
    expect(outbox.enqueueAssistantStreamDelta).not.toHaveBeenCalled();
    expect((bridge as any).assistantTextBySession.get("session-separated")).toBe("Нашел проблему в compose.");
    nowSpy.mockRestore();
  });

  it("flushes buffered assistant text before a blocking question", () => {
    /* If OpenCode asks a question after commentary, the commentary must appear as its own Telegram message first. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-question",
        sessionID: "session-question"
      }
    });
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-question",
            partID: "assistant-part-question",
            field: "text",
            delta: "Нужно уточнение перед продолжением."
          }
        })
      }
    });

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "question.asked",
          properties: {
            id: "req-q-1",
            sessionID: "session-question",
            questions: [
              {
                header: "Confirm",
                question: "Продолжаем?",
                options: [{ label: "Да" }, { label: "Нет" }]
              }
            ]
          }
        })
      }
    });

    expect(outbox.enqueueAssistantCommentary).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 10,
        text: "Нужно уточнение перед продолжением."
      })
    );
  });

  it("buffers full assistant text across frequent deltas", () => {
    /* Disabling editable previews must not drop later text chunks that arrive quickly. */
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

    expect(outbox.enqueueAssistantStreamDelta).not.toHaveBeenCalled();
    expect((bridge as any).assistantTextBySession.get("session-throttle")).toBe("Первая вторая третья");
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

    expect(outbox.enqueueProgressReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 10,
        progressKey: "runtime-notice:10:session-cooldown:cooldown",
        text: expect.stringContaining("All credentials for model gpt-5.4 are cooling down"),
        replyMarkup: {
          inlineKeyboard: [[{ text: "⏹ Стоп", callback_data: "sess-stop|active" }]]
        }
      })
    );
  });

  it("forwards cooldown notices from text-part snapshots without waiting for delta events", () => {
    /* Some runtime reconnect paths replay the full text part snapshot only once, so Telegram notice extraction must not depend on delta events. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-cooldown-snapshot",
        sessionID: "session-cooldown-snapshot",
        text: "All credentials for model gemini-3.1-pro-high are cooling down\nповтор через 16с - попытка №4"
      }
    });

    expect(outbox.enqueueProgressReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 10,
        progressKey: "runtime-notice:10:session-cooldown-snapshot:cooldown",
        text: expect.stringContaining("gemini-3.1-pro-high"),
        replyMarkup: {
          inlineKeyboard: [[{ text: "⏹ Стоп", callback_data: "sess-stop|active" }]]
        }
      })
    );
  });

  it("forwards cooldown notices from session retry status messages", () => {
    /* OpenCode can surface provider cooldowns as session.status retry events, so Telegram delivery must not depend on text parts only. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).handleSessionStatus({
      sessionID: "session-cooldown-retry",
      status: {
        type: "retry",
        attempt: 3,
        next: Date.now() + 5000,
        message: "All credentials for model gemini-3.1-pro-high are cooling down\nповтор через 5с - попытка №3"
      }
    });

    expect(outbox.enqueueProgressReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 10,
        progressKey: "runtime-notice:10:session-cooldown-retry:cooldown",
        text: expect.stringContaining("gemini-3.1-pro-high"),
        replyMarkup: {
          inlineKeyboard: [[{ text: "⏹ Стоп", callback_data: "sess-stop|active" }]]
        }
      })
    );
  });

  it("formats cooldown notice from bare retry-status message plus next/attempt fields", () => {
    /* OpenCode retry events may keep the cooldown text separate from attempt metadata, so Telegram must reconstruct one readable notice. */
    const { bridge, outbox } = makeBridge();

    const nowMs = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(nowMs);

    (bridge as any).handleSessionStatus({
      sessionID: "session-cooldown-bare-retry",
      status: {
        type: "retry",
        attempt: 2,
        next: nowMs + 3000,
        message: "All credentials for model gemini-3.1-pro-high are cooling down"
      }
    });

    expect(outbox.enqueueProgressReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 10,
        progressKey: "runtime-notice:10:session-cooldown-bare-retry:cooldown",
        text: expect.stringContaining("повтор через 3с - попытка №2")
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

  it("binds every question from one OpenCode request and shows the first step", () => {
    /* Multi-question OpenCode prompts must preserve the full questionnaire instead of dropping everything after the first item. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "question.asked",
          properties: {
            id: "req-1",
            sessionID: "session-1",
            questions: [
              {
                header: "Confirm",
                question: "Первый вопрос?",
                options: [{ label: "Да" }, { label: "Нет" }]
              },
              {
                header: "Scope",
                question: "Второй вопрос?",
                options: [{ label: "API" }, { label: "UI" }]
              }
            ]
          }
        })
      }
    });

    expect((bridge as any).routes.bindQuestion).toHaveBeenCalledWith({
      requestID: "req-1",
      sessionID: "session-1",
      adminId: 10,
      directory: "/tmp/demo",
      questions: [
        {
          header: "Confirm",
          question: "Первый вопрос?",
          options: ["Да", "Нет"],
          multiple: false
        },
        {
          header: "Scope",
          question: "Второй вопрос?",
          options: ["API", "UI"],
          multiple: false
        }
      ]
    });
    expect(outbox.enqueueProgressReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        progressKey: "question:10:req-1",
        text: "OpenCode спрашивает (1/2):\nConfirm\nПервый вопрос?"
      })
    );
  });

  it("closes active assistant progress when a question pauses the run", () => {
    /* After a blocking question, the resumed assistant answer must start in a fresh Telegram message. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "question.asked",
          properties: {
            id: "req-2",
            sessionID: "session-1",
            questions: [
              {
                header: "Confirm",
                question: "Продолжать?",
                options: [{ label: "Да" }, { label: "Нет" }]
              }
            ]
          }
        })
      }
    });

    expect(outbox.closeAssistantProgress).toHaveBeenCalledWith({ sessionId: "session-1" });
  });
});
