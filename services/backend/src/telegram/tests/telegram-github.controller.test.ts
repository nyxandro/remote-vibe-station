/**
 * @fileoverview Tests for Telegram GitHub PAT endpoints.
 */

import { Request } from "express";

import { TelegramGithubController } from "../telegram-github.controller";

describe("TelegramGithubController", () => {
  const buildController = () => {
    /* Keep GitHub service mocked to isolate request/response contracts. */
    const github = {
      saveToken: jest.fn().mockReturnValue({ ok: true }),
      getStatus: jest.fn().mockReturnValue({
        configured: true,
        connected: true,
        tokenPreview: "gith...3456",
        updatedAt: "2026-03-10T10:00:00.000Z",
        gitCredential: { connected: true, mode: "pat", updatedAt: "2026-03-10T10:00:00.000Z" }
      }),
      disconnect: jest.fn().mockReturnValue({ ok: true })
    };

    const events = { publish: jest.fn() };
    const controller = new TelegramGithubController(github as never, events as never);
    return { controller, github, events };
  };

  test("returns status for authenticated admin", () => {
    /* Mini App settings should load current PAT state from the same authenticated endpoint. */
    const { controller, github } = buildController();
    const result = controller.getStatus({ authAdminId: 7 } as unknown as Request);

    expect(github.getStatus).toHaveBeenCalledWith(7);
    expect(result.connected).toBe(true);
  });

  test("saves PAT for authenticated admin", () => {
    /* Saving a token should pass the pasted PAT to the backend service unchanged except for service-side trimming. */
    const { controller, github } = buildController();
    const result = controller.saveToken({ authAdminId: 7 } as unknown as Request, {
      token: "github_pat_example123"
    });

    expect(github.saveToken).toHaveBeenCalledWith({ adminId: 7, token: "github_pat_example123" });
    expect(result.ok).toBe(true);
  });
});
