/**
 * @fileoverview Tests for AppAuthGuard.
 *
 * Expects:
 * - Unsafe localhost bypass stays disabled by default.
 * - Explicit opt-in enables localhost bypass and derives authAdminId.
 * - Explicit opt-in also works when PUBLIC_BASE_URL is remote but request host is localhost.
 * - Non-localhost mode rejects missing auth.
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
  it("rejects unauthenticated localhost requests by default", () => {
    /* Dev mode must not silently expose admin APIs unless explicitly enabled. */
    const guard = new AppAuthGuard({
      telegramBotToken: "x",
      adminIds: [123],
      publicBaseUrl: "http://localhost:4173",
      publicDomain: "localhost",
      allowUnsafeLocalAuth: false,
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

  it("derives authAdminId on localhost only when unsafe bypass is explicitly enabled", () => {
    /* Local bypass remains available only as an intentional opt-in for isolated dev flows. */
    const guard = new AppAuthGuard({
      telegramBotToken: "x",
      adminIds: [649624756],
      publicBaseUrl: "http://127.0.0.1:4173",
      publicDomain: "localhost",
      allowUnsafeLocalAuth: true,
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

  it("allows localhost host-header bypass even when PUBLIC_BASE_URL is remote", () => {
    /* Shared VDS dev uses a public domain in config, but local browser debugging still reaches backend through 127.0.0.1. */
    const guard = new AppAuthGuard({
      telegramBotToken: "x",
      adminIds: [649624756],
      publicBaseUrl: "https://example.com",
      publicDomain: "example.com",
      allowUnsafeLocalAuth: true,
      projectsRoot: "/tmp",
      opencodeSyncOnStart: false,
      opencodeWarmRecentsOnStart: false,
      opencodeWarmRecentsLimit: 0,
      opencodeServerUrl: "http://opencode:4096",
      eventBufferSize: 100
    } as any);

    const req: any = { headers: { host: "127.0.0.1:4173" } };
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
      allowUnsafeLocalAuth: false,
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
