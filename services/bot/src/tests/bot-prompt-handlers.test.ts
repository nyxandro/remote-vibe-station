/**
 * @fileoverview Tests for extracted Telegram prompt/media handler registration.
 */

import { Telegraf } from "telegraf";

import { BotConfig } from "../config";
import { registerBotPromptHandlers } from "../bot-prompt-handlers";
import * as voiceControlModule from "../voice-control";

const flushAsyncWork = async (): Promise<void> => {
  /* Prompt handlers schedule backend calls in fire-and-forget tasks, so tests must flush microtasks explicitly. */
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe("registerBotPromptHandlers", () => {
  const config: BotConfig = {
    telegramBotToken: "token",
    adminIds: [1],
    backendUrl: "http://backend:3000",
    botBackendAuthToken: "secret-token",
    publicBaseUrl: "http://localhost:4173",
    opencodePublicBaseUrl: "http://localhost:4096",
    transportMode: "auto"
  };

  const createBotMock = (): {
    bot: Telegraf;
    getHandler: (event: string) => ((ctx: any) => Promise<void>) | undefined;
    sendMessage: jest.Mock;
  } => {
    const handlers = new Map<string, (ctx: any) => Promise<void>>();
    const sendMessage = jest.fn(async () => undefined);
    const botLike = {
      on: jest.fn((event: string, handler: (ctx: any) => Promise<void>) => {
        handlers.set(event, handler);
      }),
      telegram: {
        sendMessage
      }
    };

    return {
      bot: botLike as unknown as Telegraf,
      getHandler: (event: string) => handlers.get(event),
      sendMessage
    };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("forwards photo prompts into backend queue", async () => {
    /* Photo uploads should use the same enqueue path as text prompts and keep indicator lifecycle balanced. */
    jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({ ok: true, text: async () => "" } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, buffered: false, merged: false, position: 1 })
      } as Response);

    const mock = createBotMock();
    const indicator = {
      start: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined)
    } as any;

    registerBotPromptHandlers({
      bot: mock.bot,
      config,
      indicator,
      isAdmin: (id: number | undefined) => id === 1,
      bindChat: jest.fn(async () => undefined),
      commandSyncRuntime: {
        resolveCommandAlias: jest.fn(),
        syncSlashCommands: jest.fn(async () => undefined)
      }
    });

    const handler = mock.getHandler("photo");
    expect(handler).toBeDefined();

    await handler!({
      from: { id: 1 },
      chat: { id: 77 },
      message: {
        message_id: 33,
        caption: "inspect this",
        photo: [
          { file_id: "small", file_size: 100 },
          { file_id: "large", file_size: 400 }
        ]
      },
      reply: jest.fn(async () => undefined)
    });
    await flushAsyncWork();

    expect(indicator.start).not.toHaveBeenCalled();
    expect(indicator.stop).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://backend:3000/api/telegram/prompt/enqueue",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("rejects unsupported documents with explicit guidance", async () => {
    /* Generic file uploads should fail fast instead of silently disappearing from the operator chat. */
    const mock = createBotMock();

    registerBotPromptHandlers({
      bot: mock.bot,
      config,
      indicator: { start: jest.fn(), stop: jest.fn() } as any,
      isAdmin: (id: number | undefined) => id === 1,
      bindChat: jest.fn(async () => undefined),
      commandSyncRuntime: {
        resolveCommandAlias: jest.fn(),
        syncSlashCommands: jest.fn(async () => undefined)
      }
    });

    const handler = mock.getHandler("document");
    expect(handler).toBeDefined();
    const reply = jest.fn(async () => undefined);

    await handler!({
      from: { id: 1 },
      message: {
        document: { file_id: "doc-1", mime_type: "text/plain", file_name: "notes.txt" }
      },
      reply
    });

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("поддерживаются изображения и PDF"));
  });

  it("shows setup hint when voice control is not configured", async () => {
    /* Voice handler should return an actionable setup message before any transcription/download work starts. */
    jest.spyOn(voiceControlModule, "fetchVoiceControlSettings").mockResolvedValue({
      enabled: false,
      apiKey: null,
      model: null
    });

    const mock = createBotMock();

    registerBotPromptHandlers({
      bot: mock.bot,
      config,
      indicator: { start: jest.fn(), stop: jest.fn() } as any,
      isAdmin: (id: number | undefined) => id === 1,
      bindChat: jest.fn(async () => undefined),
      commandSyncRuntime: {
        resolveCommandAlias: jest.fn(),
        syncSlashCommands: jest.fn(async () => undefined)
      }
    });

    const handler = mock.getHandler("voice");
    expect(handler).toBeDefined();
    const reply = jest.fn(async () => undefined);

    await handler!({
      from: { id: 1 },
      chat: { id: 77 },
      message: {
        voice: { file_id: "voice-1", file_size: 1024, duration: 5, mime_type: "audio/ogg" }
      },
      reply
    });

    expect(reply).toHaveBeenCalledWith(voiceControlModule.VOICE_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE);
  });

  it("rejects unknown slash commands after one resync attempt", async () => {
    /* Text slash forwarding should retry sync once and then fail with a readable message when alias is still unknown. */
    const mock = createBotMock();
    const syncSlashCommands = jest.fn(async () => undefined);
    const resolveCommandAlias = jest.fn().mockReturnValue(undefined);

    registerBotPromptHandlers({
      bot: mock.bot,
      config,
      indicator: { start: jest.fn(), stop: jest.fn() } as any,
      isAdmin: (id: number | undefined) => id === 1,
      bindChat: jest.fn(async () => undefined),
      commandSyncRuntime: {
        resolveCommandAlias,
        syncSlashCommands
      }
    });

    const handler = mock.getHandler("text");
    expect(handler).toBeDefined();
    const reply = jest.fn(async () => undefined);

    await handler!({
      from: { id: 1 },
      chat: { id: 77 },
      message: { text: "/missing" },
      reply
    });

    expect(syncSlashCommands).toHaveBeenCalledWith(1);
    expect(resolveCommandAlias).toHaveBeenCalledTimes(2);
    expect(resolveCommandAlias).toHaveBeenNthCalledWith(1, "missing");
    expect(resolveCommandAlias).toHaveBeenNthCalledWith(2, "missing");
    expect(reply).toHaveBeenCalledWith("Неизвестная команда: /missing");
  });
});
