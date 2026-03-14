/**
 * @fileoverview Tests for TelegramInitDataGuard localhost bypass behavior.
 *
 * Expects:
 * - Missing initData is still rejected by default.
 * - Explicit localhost bypass works via request host even when PUBLIC_BASE_URL is remote.
 */

import { UnauthorizedException } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common/interfaces";

import { TelegramInitDataGuard } from "../telegram.guard";

const makeContext = (request: any): ExecutionContext => {
  /* Minimal HTTP ExecutionContext mock keeps guard tests focused on auth branching only. */
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as unknown as ExecutionContext;
};

describe("TelegramInitDataGuard", () => {
  it("rejects missing Telegram initData by default", () => {
    /* Dev bypass must stay off unless the operator opted in explicitly. */
    const guard = new TelegramInitDataGuard({
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

    expect(() => guard.canActivate(makeContext({ headers: {} } as any))).toThrow(UnauthorizedException);
  });

  it("allows localhost requests without initData when unsafe bypass is enabled", () => {
    /* Local browser debugging should remain possible on loopback even if public links point to the remote domain. */
    const guard = new TelegramInitDataGuard({
      telegramBotToken: "x",
      adminIds: [123],
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

    expect(guard.canActivate(makeContext({ headers: { host: "localhost:4173" } } as any))).toBe(true);
  });
});
