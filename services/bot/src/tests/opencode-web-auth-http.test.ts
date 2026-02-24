/**
 * @fileoverview Integration-like tests for OpenCode auth HTTP endpoints.
 */

import express from "express";

import { registerOpenCodeWebAuthHttp } from "../opencode-web-auth-http";
import { OpenCodeWebAuthService } from "../opencode-web-auth";

describe("registerOpenCodeWebAuthHttp", () => {
  test("sets Strict auth cookie on successful exchange", async () => {
    /* Cookie flags must remain secure because exchange endpoint is internet-facing. */
    const app = express();
    registerOpenCodeWebAuthHttp({
      app,
      service: {
        exchangeMagicLink: jest.fn(async () => ({ sessionId: "sid-1", adminId: 7 })),
        verifySession: jest.fn()
      } as unknown as OpenCodeWebAuthService,
      cookieName: "opencode_sid",
      cookieMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
      cookieDomain: "code.example.com"
    });

    const server = app.listen(0);
    const port = (server.address() as any).port as number;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/opencode-auth/exchange?token=t1`, {
        headers: {
          "user-agent": "jest-agent"
        },
        redirect: "manual"
      });

      expect(response.status).toBe(302);
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).toContain("Domain=code.example.com");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("returns auth admin header on successful forward-auth check", async () => {
    /* Traefik should receive authenticated admin id from check endpoint response headers. */
    const app = express();
    registerOpenCodeWebAuthHttp({
      app,
      service: {
        exchangeMagicLink: jest.fn(),
        verifySession: jest.fn(async () => ({ adminId: 42 }))
      } as unknown as OpenCodeWebAuthService,
      cookieName: "opencode_sid",
      cookieMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
      cookieDomain: "code.example.com"
    });

    const server = app.listen(0);
    const port = (server.address() as any).port as number;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/opencode-auth/check`, {
        headers: {
          "user-agent": "jest-agent",
          cookie: "opencode_sid=sid-1"
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-auth-admin-id")).toBe("42");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
