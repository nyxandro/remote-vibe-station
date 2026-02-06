/**
 * @fileoverview Tests for AppAuthGuard.
 *
 * Expects:
 * - Localhost mode allows unauthenticated browsing (L29).
 * - Localhost mode derives authAdminId when exactly one admin is configured (L43).
 * - Non-localhost mode rejects missing auth (L63).
 */

import { UnauthorizedException } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common/interfaces";

import { AppAuthGuard } from "../app-auth.guard";

const makeContext = (request: any): ExecutionContext => {
  /* Minimal ExecutionContext mock for HTTP guards. */
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as unknown as ExecutionContext;
};

describe("AppAuthGuard", () => {
  it("allows unauthenticated requests on localhost", () => {
    /* Localhost browsing should not require headers. */
    const guard = new AppAuthGuard({
      telegramBotToken: "x",
      adminIds: [123],
      publicBaseUrl: "http://localhost:4173",
      publicDomain: "localhost",
      projectsRoot: "/tmp",
      opencodeSyncOnStart: false,
      opencodeWarmRecentsOnStart: false,
      opencodeWarmRecentsLimit: 0,
      opencodeServerUrl: "http://opencode:4096",
      eventBufferSize: 100
    } as any);

    const req: any = { headers: {} };
    expect(guard.canActivate(makeContext(req))).toBe(true);
  });

  it("derives authAdminId on localhost when one admin configured", () => {
    /* In dev mode we can pick the only configured admin id. */
    const guard = new AppAuthGuard({
      telegramBotToken: "x",
      adminIds: [649624756],
      publicBaseUrl: "http://127.0.0.1:4173",
      publicDomain: "localhost",
      projectsRoot: "/tmp",
      opencodeSyncOnStart: false,
      opencodeWarmRecentsOnStart: false,
      opencodeWarmRecentsLimit: 0,
      opencodeServerUrl: "http://opencode:4096",
      eventBufferSize: 100
    } as any);

    const req: any = { headers: {} };
    expect(guard.canActivate(makeContext(req))).toBe(true);
    expect(req.authAdminId).toBe(649624756);
  });

  it("rejects missing auth when not localhost", () => {
    /* Production mode must require initData or bearer token. */
    const guard = new AppAuthGuard({
      telegramBotToken: "x",
      adminIds: [123],
      publicBaseUrl: "https://example.com",
      publicDomain: "example.com",
      projectsRoot: "/tmp",
      opencodeSyncOnStart: false,
      opencodeWarmRecentsOnStart: false,
      opencodeWarmRecentsLimit: 0,
      opencodeServerUrl: "http://opencode:4096",
      eventBufferSize: 100
    } as any);

    const req: any = { headers: {} };
    expect(() => guard.canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });
});
