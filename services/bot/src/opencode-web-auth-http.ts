/**
 * @fileoverview HTTP handlers for OpenCode magic-link exchange and forward-auth checks.
 *
 * Exports:
 * - OpenCodeWebAuthHttpOptions (L24) - Configuration for cookie/security behavior.
 * - registerOpenCodeWebAuthHttp (L37) - Binds exchange/check endpoints into Express app.
 */

import { Express, Request, Response } from "express";

import { OpenCodeWebAuthService } from "./opencode-web-auth";

const COOKIE_SEPARATOR = ";";
const COOKIE_KV_SEPARATOR = "=";
const QUERY_TOKEN_KEY = "token";
const DEFAULT_REDIRECT_PATH = "/";

export type OpenCodeWebAuthHttpOptions = {
  app: Express;
  service: OpenCodeWebAuthService;
  cookieName: string;
  cookieMaxAgeMs: number;
  cookieDomain?: string;
};

const AUTH_ADMIN_ID_HEADER = "X-Auth-Admin-ID";

export const registerOpenCodeWebAuthHttp = (options: OpenCodeWebAuthHttpOptions): void => {
  /* Exchange one-time magic link into month-long secure cookie session. */
  options.app.get("/opencode-auth/exchange", async (request, response) => {
    const rawToken = String(request.query?.[QUERY_TOKEN_KEY] ?? "").trim();
    if (!rawToken) {
      response.status(400).send("token is required");
      return;
    }

    const fingerprint = buildFingerprint(request);
    if (!fingerprint) {
      response.status(401).send("Device fingerprint is required");
      return;
    }

    try {
      const session = await options.service.exchangeMagicLink({
        token: rawToken,
        fingerprint
      });

      setAuthCookie({
        response,
        cookieName: options.cookieName,
        cookieValue: session.sessionId,
        cookieMaxAgeMs: options.cookieMaxAgeMs,
        cookieDomain: options.cookieDomain
      });

      response.redirect(302, DEFAULT_REDIRECT_PATH);
    } catch {
      response.status(401).send("Magic link is invalid or expired");
    }
  });

  /* Forward-auth endpoint used by Traefik before every OpenCode UI request. */
  options.app.get("/opencode-auth/check", async (request, response) => {
    try {
      const fingerprint = buildFingerprint(request);
      if (!fingerprint) {
        response.status(401).send("Unauthorized");
        return;
      }

      const cookies = parseCookies(request.headers.cookie);
      const sessionId = cookies.get(options.cookieName);
      if (!sessionId) {
        response.status(401).send("Unauthorized");
        return;
      }

      const session = await options.service.verifySession({
        sessionId,
        fingerprint
      });

      if (!session) {
        response.status(401).send("Unauthorized");
        return;
      }

      /* Forward authenticated admin context to upstream via Traefik forward-auth headers. */
      response.setHeader(AUTH_ADMIN_ID_HEADER, String(session.adminId));
      response.status(200).send("OK");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("OpenCode auth check failed", error);
      response.status(401).send("Unauthorized");
    }
  });
};

const parseCookies = (cookieHeader: string | undefined): Map<string, string> => {
  /* Parse Cookie header without extra dependencies. */
  const map = new Map<string, string>();
  if (!cookieHeader) {
    return map;
  }

  cookieHeader.split(COOKIE_SEPARATOR).forEach((item) => {
    const trimmed = item.trim();
    if (!trimmed) {
      return;
    }

    const kvIndex = trimmed.indexOf(COOKIE_KV_SEPARATOR);
    if (kvIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, kvIndex).trim();
    const value = trimmed.slice(kvIndex + 1).trim();
    if (!key || !value) {
      return;
    }

    map.set(key, value);
  });

  return map;
};

const setAuthCookie = (input: {
  response: Response;
  cookieName: string;
  cookieValue: string;
  cookieMaxAgeMs: number;
  cookieDomain?: string;
}): void => {
  /* Keep browser cookie secure and non-readable from JavaScript. */
  input.response.cookie(input.cookieName, input.cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: input.cookieMaxAgeMs,
    domain: input.cookieDomain,
    path: "/"
  });
};

const buildFingerprint = (request: Request): string | null => {
  /* Bind session to User-Agent + client IP to reduce cookie replay risk. */
  const userAgent = String(request.headers["user-agent"] ?? "").trim();
  const remoteIp = String(request.ip ?? "").trim();

  if (!userAgent || !remoteIp) {
    return null;
  }

  return `${userAgent}|${remoteIp}`;
};
