/**
 * @fileoverview Signed web token generator for opening Mini App in a browser.
 *
 * Exports:
 * - createWebToken (L18) - Creates a short-lived token signed with bot token.
 */

import * as crypto from "node:crypto";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Payload = {
  adminId: number;
  exp: number;
  nonce: string;
};

export const createWebToken = (input: {
  adminId: number;
  botToken: string;
  nowMs?: number;
}): string => {
  /* Create a signed token for browser auth. */
  const nowMs = input.nowMs ?? Date.now();
  const payload: Payload = {
    adminId: input.adminId,
    exp: nowMs + TOKEN_TTL_MS,
    nonce: crypto.randomBytes(8).toString("hex")
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(Buffer.from(payloadJson, "utf-8"));
  const signature = sign(payloadJson, input.botToken);
  const signatureB64 = base64UrlEncode(signature);
  return `${payloadB64}.${signatureB64}`;
};

const sign = (payloadJson: string, botToken: string): Buffer => {
  /* Match backend signing logic: HMAC-SHA256(sha256(botToken), payload). */
  const key = crypto.createHash("sha256").update(botToken).digest();
  return crypto.createHmac("sha256", key).update(payloadJson).digest();
};

const base64UrlEncode = (buf: Buffer): string => {
  /* RFC 4648 base64url without padding. */
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};
