/**
 * @fileoverview Tests for TelegramPreferencesService mode and voice-control settings.
 *
 * Exports:
 * - (none)
 */

import { TelegramPreferencesService } from "../telegram-preferences.service";

describe("TelegramPreferencesService voice control", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns disabled snapshot when key/model are not configured", () => {
    /* Empty persisted settings must keep voice control explicitly disabled. */
    const store = {
      get: jest.fn().mockReturnValue({}),
      set: jest.fn()
    };

    const service = new TelegramPreferencesService(store as never, {} as never, {} as never);
    const snapshot = service.getVoiceControlSettings(42);

    expect(snapshot).toEqual({
      enabled: false,
      hasApiKey: false,
      model: null,
      supportedModels: ["whisper-large-v3-turbo", "whisper-large-v3"]
    });
  });

  it("returns bot-only snapshot with api key for internal transcription flow", () => {
    /* Public UI must not receive the raw key, but internal bot path still needs it. */
    const store = {
      get: jest.fn().mockReturnValue({
        voiceControl: {
          groqApiKey: "gsk_live_123",
          model: "whisper-large-v3"
        }
      }),
      set: jest.fn()
    };

    const service = new TelegramPreferencesService(store as never, {} as never, {} as never);
    const snapshot = service.getVoiceControlSecretSettings(42);

    expect(snapshot).toEqual({
      enabled: true,
      apiKey: "gsk_live_123",
      model: "whisper-large-v3",
      supportedModels: ["whisper-large-v3-turbo", "whisper-large-v3"]
    });
  });

  it("persists trimmed api key and selected model only after Groq accepts the key", async () => {
    /* Update should normalize data once and persist exact validated values. */
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    const store = {
      get: jest.fn().mockReturnValue({}),
      set: jest.fn()
    };

    const service = new TelegramPreferencesService(store as never, {} as never, {} as never);
    const snapshot = await service.updateVoiceControlSettings(42, {
      apiKey: "  gsk_live_123  ",
      model: "whisper-large-v3"
    });

    expect(store.set).toHaveBeenCalledWith(42, {
      voiceControl: {
        groqApiKey: "gsk_live_123",
        model: "whisper-large-v3"
      }
    });
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.hasApiKey).toBe(true);
    expect(snapshot.model).toBe("whisper-large-v3");
  });

  it("rejects invalid Groq keys before persisting them", async () => {
    /* Invalid credentials must fail fast during settings save so the bot never keeps retrying a broken key. */
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 403 } as Response);

    const store = {
      get: jest.fn().mockReturnValue({}),
      set: jest.fn()
    };

    const service = new TelegramPreferencesService(store as never, {} as never, {} as never);

    await expect(
      service.updateVoiceControlSettings(42, {
        apiKey: "gsk_live_123",
        model: "whisper-large-v3-turbo"
      })
    ).rejects.toThrow(/APP_GROQ_ACCESS_FORBIDDEN/);

    expect(store.set).not.toHaveBeenCalled();
  });

  it("marks 401 as an invalid Groq key instead of generic forbidden access", async () => {
    /* 401 is the canonical auth rejection and should still point the operator to the saved key. */
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 401 } as Response);

    const store = {
      get: jest.fn().mockReturnValue({}),
      set: jest.fn()
    };

    const service = new TelegramPreferencesService(store as never, {} as never, {} as never);

    await expect(
      service.updateVoiceControlSettings(42, {
        apiKey: "gsk_live_123",
        model: "whisper-large-v3-turbo"
      })
    ).rejects.toThrow(
      "APP_GROQ_API_KEY_REJECTED: Groq отклонил API key. Сохраните действительный ключ Groq в настройках голосового управления и повторите попытку."
    );

    expect(store.set).not.toHaveBeenCalled();
  });

  it("throws for unsupported model values", async () => {
    /* Fail fast on invalid model IDs so bot never calls Groq with unknown model. */
    const store = {
      get: jest.fn().mockReturnValue({}),
      set: jest.fn()
    };

    const service = new TelegramPreferencesService(store as never, {} as never, {} as never);

    await expect(
      service.updateVoiceControlSettings(42, {
        apiKey: "gsk_live_123",
        model: "whisper-v2"
      })
    ).rejects.toThrow("Unsupported Groq model");

    expect(store.set).not.toHaveBeenCalled();
  });

  it("keeps voice control fields when model settings are updated", async () => {
    /* Settings update must not wipe independent voice-control credentials. */
    const store = {
      get: jest.fn().mockReturnValue({
        model: { providerID: "opencode", modelID: "big-pickle" },
        thinking: null,
        agent: "build",
        voiceControl: {
          groqApiKey: "gsk_live_123",
          model: "whisper-large-v3"
        }
      }),
      set: jest.fn()
    };

    const opencode = {
      listProviders: jest.fn().mockResolvedValue([{ id: "opencode", name: "OpenCode" }]),
      listModels: jest.fn().mockResolvedValue([
        {
          id: "big-pickle",
          name: "Big Pickle",
          variants: ["low", "medium", "high"]
        }
      ]),
      listAgents: jest.fn().mockResolvedValue([{ name: "build", mode: "primary" }]),
      updateDefaultExecutionMode: jest.fn().mockResolvedValue(undefined)
    };
    const opencodeSettings = {
      listCustomAgentNames: jest.fn().mockReturnValue([])
    };

    const service = new TelegramPreferencesService(store as never, opencode as never, opencodeSettings as never);
    await service.updateSettings(42, {
      providerID: "opencode",
      modelID: "big-pickle",
      thinking: "low",
      agent: "build"
    });

    expect(store.set).toHaveBeenCalledWith(42, {
      model: { providerID: "opencode", modelID: "big-pickle" },
      thinking: "low",
      agent: "build",
      voiceControl: {
        groqApiKey: "gsk_live_123",
        model: "whisper-large-v3"
      }
    });
    expect(opencode.updateDefaultExecutionMode).toHaveBeenCalledWith({
      model: { providerID: "opencode", modelID: "big-pickle" },
      agent: "build"
    });
  });

  it("syncs OpenCode default config when Telegram model and agent change", async () => {
    /* Telegram mode changes should also update OpenCode Web default selection so both surfaces stay aligned. */
    const store = {
      get: jest.fn().mockReturnValue({}),
      set: jest.fn()
    };

    const opencode = {
      listProviders: jest.fn().mockResolvedValue([{ id: "cliproxy", name: "CLIProxy" }]),
      listModels: jest.fn().mockResolvedValue([
        {
          id: "gpt-5.4",
          name: "GPT-5.4",
          variants: ["low", "medium", "high"]
        }
      ]),
      listAgents: jest.fn().mockResolvedValue([{ name: "build", mode: "primary" }, { name: "plan", mode: "primary" }]),
      updateDefaultExecutionMode: jest.fn().mockResolvedValue(undefined)
    };
    const opencodeSettings = {
      listCustomAgentNames: jest.fn().mockReturnValue([])
    };

    const service = new TelegramPreferencesService(store as never, opencode as never, opencodeSettings as never);
    await service.updateSettings(42, {
      providerID: "cliproxy",
      modelID: "gpt-5.4",
      thinking: "high",
      agent: "plan"
    });

    expect(opencode.updateDefaultExecutionMode).toHaveBeenCalledWith({
      model: { providerID: "cliproxy", modelID: "gpt-5.4" },
      agent: "plan"
    });
  });

  it("does not persist Telegram mode when OpenCode config sync fails", async () => {
    /* Failing browser-sync must abort the update so Telegram and Web UI do not drift silently. */
    const store = {
      get: jest.fn().mockReturnValue({}),
      set: jest.fn()
    };

    const opencode = {
      listProviders: jest.fn().mockResolvedValue([{ id: "cliproxy", name: "CLIProxy" }]),
      listModels: jest.fn().mockResolvedValue([
        {
          id: "gpt-5.4",
          name: "GPT-5.4",
          variants: ["low", "medium", "high"]
        }
      ]),
      listAgents: jest.fn().mockResolvedValue([{ name: "build", mode: "primary" }]),
      updateDefaultExecutionMode: jest.fn().mockRejectedValue(new Error("APP_OPENCODE_CONFIG_SYNC_FAILED"))
    };
    const opencodeSettings = {
      listCustomAgentNames: jest.fn().mockReturnValue([])
    };

    const service = new TelegramPreferencesService(store as never, opencode as never, opencodeSettings as never);

    await expect(
      service.updateSettings(42, {
        providerID: "cliproxy",
        modelID: "gpt-5.4",
        thinking: "medium",
        agent: "build"
      })
    ).rejects.toThrow("APP_OPENCODE_CONFIG_SYNC_FAILED");

    expect(store.set).not.toHaveBeenCalled();
  });
});
