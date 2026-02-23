/**
 * @fileoverview Tests for TelegramPreferencesService voice-control settings.
 *
 * Exports:
 * - (none)
 */

import { TelegramPreferencesService } from "../telegram-preferences.service";

describe("TelegramPreferencesService voice control", () => {
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
      apiKey: null,
      model: null,
      supportedModels: ["whisper-large-v3-turbo", "whisper-large-v3"]
    });
  });

  it("persists trimmed api key and selected model", () => {
    /* Update should normalize data once and persist exact validated values. */
    const store = {
      get: jest.fn().mockReturnValue({}),
      set: jest.fn()
    };

    const service = new TelegramPreferencesService(store as never, {} as never, {} as never);
    const snapshot = service.updateVoiceControlSettings(42, {
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
    expect(snapshot.apiKey).toBe("gsk_live_123");
    expect(snapshot.model).toBe("whisper-large-v3");
  });

  it("throws for unsupported model values", () => {
    /* Fail fast on invalid model IDs so bot never calls Groq with unknown model. */
    const store = {
      get: jest.fn().mockReturnValue({}),
      set: jest.fn()
    };

    const service = new TelegramPreferencesService(store as never, {} as never, {} as never);

    expect(() =>
      service.updateVoiceControlSettings(42, {
        apiKey: "gsk_live_123",
        model: "whisper-v2"
      })
    ).toThrow("Unsupported Groq model");

    expect(store.set).not.toHaveBeenCalled();
  });
});
