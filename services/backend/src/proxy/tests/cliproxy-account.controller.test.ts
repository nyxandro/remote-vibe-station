/**
 * @fileoverview Tests for CLIProxy account controller contracts.
 */

import { Request } from "express";
import { BadRequestException } from "@nestjs/common";

import { CliproxyAccountController } from "../cliproxy-account.controller";

describe("CliproxyAccountController", () => {
  test("returns current cliproxy account state", async () => {
    /* Controller should pass account status payload through unchanged. */
    const service = {
      getState: jest.fn().mockResolvedValue({
        usageTrackingEnabled: false,
        providers: [{ id: "codex", label: "Codex", connected: false }],
        accounts: []
      }),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn()
    };

    const controller = new CliproxyAccountController(service as never);
    const result = await controller.getState({ authAdminId: 649624756 } as unknown as Request);

    expect(service.getState).toHaveBeenCalledTimes(1);
    expect(result.providers[0].id).toBe("codex");
  });

  test("starts oauth for selected provider", async () => {
    /* Start endpoint should return URL/state for browser handoff. */
    const service = {
      getState: jest.fn(),
      startOAuth: jest.fn().mockResolvedValue({
        provider: "codex",
        state: "state1",
        url: "https://auth.openai.com/...",
        instructions: "Open URL and paste callback URL here"
      }),
      completeOAuth: jest.fn()
    };

    const controller = new CliproxyAccountController(service as never);
    const result = await controller.startOAuth({ provider: "codex" }, { authAdminId: 649624756 } as unknown as Request);

    expect(service.startOAuth).toHaveBeenCalledWith({ provider: "codex" });
    expect(result.provider).toBe("codex");
  });

  test("rejects oauth start for missing provider", async () => {
    /* Start flow must fail fast when provider id is absent. */
    const service = {
      getState: jest.fn(),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn()
    };

    const controller = new CliproxyAccountController(service as never);

    await expect(
      controller.startOAuth({}, { authAdminId: 649624756 } as unknown as Request)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.startOAuth).not.toHaveBeenCalled();
  });

  test("forwards validated oauth completion payload", async () => {
    /* Completion endpoint should pass through explicit code/state payload after validation. */
    const service = {
      getState: jest.fn(),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn().mockResolvedValue(undefined)
    };

    const controller = new CliproxyAccountController(service as never);
    const result = await controller.completeOAuth(
      {
        provider: "codex",
        code: "abc",
        state: "state-1"
      },
      { authAdminId: 649624756 } as unknown as Request
    );

    expect(service.completeOAuth).toHaveBeenCalledWith({
      provider: "codex",
      callbackUrl: undefined,
      code: "abc",
      state: "state-1",
      error: undefined
    });
    expect(result).toEqual({ ok: true });
  });

  test("rejects completion without callback and without code/state", async () => {
    /* Controller must block incomplete payload before service call. */
    const service = {
      getState: jest.fn(),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn()
    };

    const controller = new CliproxyAccountController(service as never);

    await expect(
      controller.completeOAuth(
        {
          provider: "codex",
          code: "abc"
        },
        { authAdminId: 649624756 } as unknown as Request
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.completeOAuth).not.toHaveBeenCalled();
  });
});
