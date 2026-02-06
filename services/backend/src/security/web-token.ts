/**
 * @fileoverview Signed web token helpers for browser access.
 *
 * Why:
 * - Mini App may be opened in a regular browser (no Telegram initData).
 * - We still need an authenticated admin identity to control Telegram stream.
 * - Tokens are signed using the Telegram bot token as a shared secret.
 *
 * Exports:
 * - createWebToken (L26) - Creates a short-lived signed token for an admin.
 * - verifyWebToken (L51) - Verifies token signature and expiry.
 */

import * as crypto from "node:crypto";

const DOT = ".";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type WebTokenPayload = {
  adminId: number;
  exp: number;
  nonce: string;
};

export const createWebToken = (input: {
  adminId: number;
  botToken: string;
  nowMs?: number;
}): string => {
  /* Create a deterministic, signed token. */
  const nowMs = input.nowMs ?? Date.now();

  const payload: WebTokenPayload = {
    adminId: input.adminId,
    exp: nowMs + TOKEN_TTL_MS,
    nonce: crypto.randomBytes(8).toString("hex")
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(Buffer.from(payloadJson, "utf-8"));
  const signature = sign(payloadJson, input.botToken);
  const signatureB64 = base64UrlEncode(signature);
  return `${payloadB64}${DOT}${signatureB64}`;
};

export const verifyWebToken = (input: {
  token: string;
  botToken: string;
  nowMs?: number;
}): { adminId: number } | null => {
  /* Verify signature and expiry; return adminId on success. */
  const nowMs = input.nowMs ?? Date.now();

  const [payloadB64, signatureB64] = input.token.split(DOT);
  if (!payloadB64 || !signatureB64) {
    return null;
  }

  const payloadJson = base64UrlDecodeToString(payloadB64);
  if (!payloadJson) {
    return null;
  }

  const expected = sign(payloadJson, input.botToken);
  const actual = base64UrlDecode(signatureB64);
  if (!actual) {
    return null;
  }

  if (!crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  const payload = safeJsonParse(payloadJson) as WebTokenPayload | null;
  if (!payload || typeof payload.adminId !== "number" || typeof payload.exp !== "number") {
    return null;
  }

  if (nowMs >= payload.exp) {
    return null;
  }

  return { adminId: payload.adminId };
};

const sign = (payloadJson: string, botToken: string): Buffer => {
  /* Sign payload using HMAC-SHA256(sha256(botToken), payload). */
  const key = crypto.createHash("sha256").update(botToken).digest();
  return crypto.createHmac("sha256", key).update(payloadJson).digest();
};

const safeJsonParse = (raw: string): unknown | null => {
  /* Best-effort JSON parsing. */
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const base64UrlEncode = (buf: Buffer): string => {
  /* RFC 4648 base64url without padding. */
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const base64UrlDecode = (b64url: string): Buffer | null => {
  /* Decode base64url string into bytes. */
  try {
    const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
    return Buffer.from(padded, "base64");
  } catch {
    return null;
  }
};

const base64UrlDecodeToString = (b64url: string): string | null => {
  /* Decode base64url payload to UTF-8 string. */
  const buf = base64UrlDecode(b64url);
  return buf ? buf.toString("utf-8") : null;
};
