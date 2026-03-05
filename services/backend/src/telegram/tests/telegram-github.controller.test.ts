/**
 * @fileoverview Tests for Telegram GitHub connect endpoints.
 *
 * Exports:
 * - (none)
 */

import { Request } from "express";

import { TelegramGithubController } from "../telegram-github.controller";

describe("TelegramGithubController", () => {
  const buildController = () => {
    /* Keep GitHub service mocked to isolate request/response contracts. */
    const github = {
      startInstall: jest.fn().mockReturnValue({
        url: "https://github.com/apps/my-station/installations/new?state=abc",
        state: "abc",
        expiresAt: "2030-01-01T00:00:00.000Z"
      }),
      getStatus: jest.fn().mockReturnValue({ connected: true, installationId: 123 }),
      disconnect: jest.fn().mockReturnValue({ ok: true }),
      completeInstall: jest.fn().mockReturnValue({
        adminId: 7,
        installationId: 123,
        accountLogin: "my-org",
        setupAction: "install"
      })
    };

    const controller = new TelegramGithubController(github as never);
    return { controller, github };
  };

  test("returns connect URL for authenticated admin", () => {
    /* Mini App starts GitHub install flow from explicit backend endpoint. */
    const { controller, github } = buildController();
    const result = controller.startInstall({ authAdminId: 7 } as unknown as Request);

    expect(github.startInstall).toHaveBeenCalledWith(7);
    expect(result.state).toBe("abc");
  });

  test("returns callback html after successful installation", () => {
    /* Browser callback should render deterministic success page for user handoff. */
    const { controller, github } = buildController();
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis()
    } as any;
    const html = controller.callback({
      state: "abc",
      installation_id: "123",
      setup_action: "install",
      account: { login: "my-org", type: "Organization" }
    }, response);

    expect(github.completeInstall).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "text/html; charset=utf-8");
    expect(html.includes("GitHub подключен")).toBe(true);
  });
});
