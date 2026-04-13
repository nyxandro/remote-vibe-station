/**
 * @fileoverview Tests for bot configuration loader.
 *
 * Exports:
 * - (none)
 *
 * Tests:
 * - setEnv (L17) - Helper to mutate process.env.
 * - loadConfig suite (L28) - Validation test cases.
 */

import { loadConfig } from "../config";

const baseEnv = {
  TELEGRAM_BOT_TOKEN: "token",
  ADMIN_IDS: "123",
  BACKEND_URL: "http://backend:3000",
  BOT_BACKEND_AUTH_TOKEN: "secret-token",
  PUBLIC_BASE_URL: "https://example.com",
  OPENCODE_PUBLIC_BASE_URL: "https://code.example.com"
};

const setEnv = (env: Record<string, string | undefined>): void => {
  /* Replace process.env entries for test. */
  Object.entries(env).forEach(([key, value]) => {
    if (typeof value === "undefined") {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  });
};

describe("loadConfig", () => {
  /* Clear environment after each test. */
  afterEach(() => {
    setEnv({
      TELEGRAM_BOT_TOKEN: undefined,
      ADMIN_IDS: undefined,
      BACKEND_URL: undefined,
      BOT_BACKEND_AUTH_TOKEN: undefined,
      PUBLIC_BASE_URL: undefined,
      OPENCODE_PUBLIC_BASE_URL: undefined
    });
  });

  it("throws when required fields are missing", () => {
    /* Ensure validation fails on missing env. */
    setEnv({});
    expect(() => loadConfig()).toThrow();
  });

  it("parses configuration from environment", () => {
    /* Load configuration with required values. */
    setEnv(baseEnv);
    const config = loadConfig();

    expect(config.telegramBotToken).toBe("token");
    expect(config.adminIds).toEqual([123]);
    expect(config.backendUrl).toBe("http://backend:3000");
    expect(config.botBackendAuthToken).toBe("secret-token");
    expect(config.opencodePublicBaseUrl).toBe("https://code.example.com");
    expect(config.transportMode).toBe("auto");
  });

  it("allows localhost http PUBLIC_BASE_URL for dev", () => {
    setEnv({
      ...baseEnv,
      PUBLIC_BASE_URL: "http://localhost:4173",
      OPENCODE_PUBLIC_BASE_URL: "http://localhost:4096"
    });

    const config = loadConfig();
    expect(config.publicBaseUrl).toBe("http://localhost:4173");
    expect(config.opencodePublicBaseUrl).toBe("http://localhost:4096");
  });

  it("parses explicit transport mode override", () => {
    setEnv({
      ...baseEnv,
      TELEGRAM_TRANSPORT_MODE: "polling"
    });

    const config = loadConfig();
    expect(config.transportMode).toBe("polling");
  });
});
