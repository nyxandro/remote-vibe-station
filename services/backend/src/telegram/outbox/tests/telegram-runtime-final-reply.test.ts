/**
 * @fileoverview Tests for fallback final-reply delivery from runtime buffers on idle turns.
 *
 * Exports:
 * - none (Jest suite).
 */

import { TelegramOpenCodeRuntimeBridge } from "../telegram-opencode-runtime-bridge.service";

const makeBridge = () => {
  /* Keep dependencies explicit so idle-finalization behavior can be tested without the full backend graph. */
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
    enqueueAssistantReply: jest.fn(),
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

describe("Telegram runtime final reply fallback", () => {
  it("converts the last buffered text segment into a final assistant reply on idle", () => {
    /* Runtime-only completions must still end with one final Telegram bubble that carries footer metadata. */
    const { bridge, outbox } = makeBridge();

    (bridge as any).onEvent({
      type: "opencode.turn.started",
      ts: new Date().toISOString(),
      data: {
        sessionId: "session-runtime-final",
        providerID: "cliproxy",
        modelID: "gpt-5.4",
        thinking: "medium",
        agent: "build"
      }
    });
    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-1",
        sessionID: "session-runtime-final"
      }
    });
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-runtime-final",
            partID: "assistant-part-1",
            field: "text",
            delta: "Финальный ответ только из runtime stream"
          }
        })
      }
    });

    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "session.idle",
          properties: {
            sessionID: "session-runtime-final"
          }
        })
      }
    });

    expect(outbox.enqueueAssistantReply).toHaveBeenCalledWith({
      adminId: 10,
      delivery: expect.objectContaining({
        sessionId: "session-runtime-final",
        text: "Финальный ответ только из runtime stream",
        providerID: "cliproxy",
        modelID: "gpt-5.4",
        thinking: "medium",
        agent: "build",
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
      })
    });
  });

  it("evicts stale turn metadata automatically when the idle finalization arrives too late", () => {
    /* Metadata cache should self-clean so abandoned sessions cannot grow memory forever. */
    const { bridge, outbox } = makeBridge();
    const nowSpy = jest.spyOn(Date, "now");

    nowSpy.mockReturnValue(1_000);
    (bridge as any).onEvent({
      type: "opencode.turn.started",
      ts: new Date().toISOString(),
      data: {
        sessionId: "session-stale",
        providerID: "cliproxy",
        modelID: "gpt-5.4",
        thinking: "medium",
        agent: "build"
      }
    });
    (bridge as any).handlePartUpdated({
      part: {
        type: "text",
        id: "assistant-part-stale",
        sessionID: "session-stale"
      }
    });
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "message.part.delta",
          properties: {
            sessionID: "session-stale",
            partID: "assistant-part-stale",
            field: "text",
            delta: "Поздний ответ"
          }
        })
      }
    });

    nowSpy.mockReturnValue(7 * 60 * 60 * 1000);
    (bridge as any).onEvent({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: {
        payload: JSON.stringify({
          type: "session.idle",
          properties: {
            sessionID: "session-stale"
          }
        })
      }
    });

    expect(outbox.enqueueAssistantReply).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});
