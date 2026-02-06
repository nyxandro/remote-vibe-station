/**
 * @fileoverview Tests for environment configuration loader.
 *
 * Exports:
 * - (none)
 *
 * Tests:
 * - setEnv (L19) - Helper to mutate process.env.
 * - loadConfig suite (L30) - Validation test cases.
 */

import { loadConfig } from "../config";

const baseEnv = {
  TELEGRAM_BOT_TOKEN: "token",
  ADMIN_IDS: "123",
  PUBLIC_BASE_URL: "https://example.com",
  PUBLIC_DOMAIN: "example.com",
  PROJECTS_ROOT: "/srv/projects",
  OPENCODE_SERVER_URL: "http://opencode:4096"
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
  /* Restore baseline environment after each test. */
  afterEach(() => {
    setEnv({
      TELEGRAM_BOT_TOKEN: undefined,
      ADMIN_IDS: undefined,
      PUBLIC_BASE_URL: undefined,
      PUBLIC_DOMAIN: undefined,
      PROJECTS_ROOT: undefined,
      OPENCODE_SERVER_URL: undefined,
      OPENCODE_SERVER_PASSWORD: undefined,
      OPENCODE_SERVER_USERNAME: undefined,
      EVENT_BUFFER_SIZE: undefined
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
    expect(config.publicDomain).toBe("example.com");
  });

  it("requires username when password is set", () => {
    /* Fail when password is set without username. */
    setEnv({ ...baseEnv, OPENCODE_SERVER_PASSWORD: "secret" });
    expect(() => loadConfig()).toThrow();
  });
});
