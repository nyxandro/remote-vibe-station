/**
 * @fileoverview Tests for Telegram initData verification.
 *
 * Exports:
 * - (none)
 *
 * Tests:
 * - buildInitData (L12) - Helper to generate signed initData.
 * - verifyInitData suite (L34) - Signature validation cases.
 */

import * as crypto from "node:crypto";

import { extractUserId, verifyInitData } from "../telegram-init-data";

const WEB_APP_DATA_KEY = "WebAppData";

const buildInitData = (botToken: string): string => {
  /* Build a signed initData string with valid hash. */
  const params = new URLSearchParams();
  params.set("query_id", "AAHdF6IQAAAAAN0XohwTZ9NP");
  params.set("user", JSON.stringify({ id: 123, first_name: "Test" }));
  params.set("auth_date", "1700000000");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  /* Build secret key exactly as Telegram WebApp docs define it. */
  const secretKey = crypto.createHmac("sha256", WEB_APP_DATA_KEY).update(botToken).digest();
  const hash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  params.set("hash", hash);
  return params.toString();
};

describe("verifyInitData", () => {
  it("returns true for valid data", () => {
    /* Validate signature for generated initData. */
    const botToken = "test:token";
    const initData = buildInitData(botToken);

    expect(verifyInitData(initData, botToken)).toBe(true);
    expect(extractUserId(initData)).toBe(123);
  });

  it("returns false for invalid hash", () => {
    /* Ensure invalid hashes are rejected. */
    const botToken = "test:token";
    const initData = buildInitData(botToken).replace("hash=", "hash=deadbeef");

    expect(verifyInitData(initData, botToken)).toBe(false);
  });

  it("returns false when bot token differs", () => {
    /* initData must be verified only with the token of the launching bot. */
    const botToken = "test:token";
    const initData = buildInitData(botToken);

    expect(verifyInitData(initData, "another:token")).toBe(false);
  });
});
