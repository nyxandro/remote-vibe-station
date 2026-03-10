/**
 * @fileoverview Tests for TelegramOpenCodeRuntimeBridge replay protection of finalized tool parts.
 *
 * Exports/constructs:
 * - makeBridge (L11) - Creates bridge with minimal mocked dependencies.
 * - describe("TelegramOpenCodeRuntimeBridge finalized tool replay", ...) - Verifies stale completed tool replays are ignored.
 */

import { TelegramOpenCodeRuntimeBridge } from "../telegram-opencode-runtime-bridge.service";

const makeBridge = () => {
  /* Keep dependencies explicit so replay protection can be tested in isolation. */
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

describe("TelegramOpenCodeRuntimeBridge finalized tool replay", () => {
  it("ignores replayed completed bash parts", () => {
    /* Long-running chats can replay old completed tool parts; Telegram must not resend them as a new burst. */
    const { bridge, outbox } = makeBridge();

    const completedBashPart = {
      part: {
        type: "tool",
        id: "bash-part-1",
        callID: "call-1",
        sessionID: "session-replay",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "npm run lint" },
          metadata: { output: "ok" }
        }
      }
    };

    (bridge as any).handlePartUpdated(completedBashPart);
    (bridge as any).handlePartUpdated(completedBashPart);

    expect(outbox.enqueueProgressReplace).toHaveBeenCalledTimes(1);
  });
});
