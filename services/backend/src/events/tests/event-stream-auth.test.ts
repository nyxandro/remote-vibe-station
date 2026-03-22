/**
 * @fileoverview Tests for signed event-stream token helpers.
 */

import * as crypto from "node:crypto";

import { createEventStreamToken, verifyEventStreamToken } from "../event-stream-auth";

describe("event-stream auth helpers", () => {
  test("round-trips signed token payload for terminal subscription", () => {
    /* Gateway auth must preserve admin scope and requested project subscription. */
    const token = createEventStreamToken({
      adminId: 42,
      botToken: "bot-token",
      topics: ["terminal"],
      projectSlug: "alpha",
      nowMs: 1_000
    });

    expect(
      verifyEventStreamToken({
        token,
        botToken: "bot-token",
        nowMs: 2_000
      })
    ).toEqual({
      adminId: 42,
      topics: ["terminal"],
      projectSlug: "alpha"
    });
  });

  test("round-trips signed token payload for workspace subscription without project scope", () => {
    /* Global workspace updates should be subscribable even when no concrete project is selected yet. */
    const token = createEventStreamToken({
      adminId: 99,
      botToken: "bot-token",
      topics: ["workspace"],
      nowMs: 5_000
    });

    expect(
      verifyEventStreamToken({
        token,
        botToken: "bot-token",
        nowMs: 6_000
      })
    ).toEqual({
      adminId: 99,
      topics: ["workspace"],
      projectSlug: null
    });
  });

  test("rejects malformed signature payloads instead of throwing", () => {
    /* Invalid signatures should fail closed with null, not bubble as 500-class crashes. */
    const token = createEventStreamToken({
      adminId: 7,
      botToken: "bot-token",
      topics: ["kanban"],
      nowMs: 1_000
    });

    const [payload] = token.split(".");
    expect(
      verifyEventStreamToken({
        token: `${payload}.bad`,
        botToken: "bot-token",
        nowMs: 2_000
      })
    ).toBeNull();
  });

  test("requires explicit project slug for terminal subscriptions", () => {
    /* Terminal chunks must never subscribe without a concrete project boundary. */
    expect(() =>
      createEventStreamToken({
        adminId: 1,
        botToken: "bot-token",
        topics: ["terminal"]
      })
    ).toThrow("projectSlug is required for terminal topic");
  });

  test("rejects non-object payload JSON instead of trusting unsafe cast", () => {
    /* Malformed tokens that decode into arrays/primitives must fail closed before shape checks run. */
    const payloadJson = JSON.stringify(["oops"]);
    const payload = Buffer.from(payloadJson, "utf-8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const key = crypto.createHash("sha256").update("bot-token").digest();
    const signature = crypto
      .createHmac("sha256", key)
      .update(payloadJson)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    expect(
      verifyEventStreamToken({
        token: `${payload}.${signature}`,
        botToken: "bot-token",
        nowMs: 1_000
      })
    ).toBeNull();
  });
});
