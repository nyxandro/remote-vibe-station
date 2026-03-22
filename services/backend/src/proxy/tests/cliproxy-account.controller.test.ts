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
      completeOAuth: jest.fn(),
      testAccount: jest.fn(),
      activateAccount: jest.fn(),
      deleteAccount: jest.fn()
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
      completeOAuth: jest.fn(),
      testAccount: jest.fn(),
      activateAccount: jest.fn(),
      deleteAccount: jest.fn()
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
      completeOAuth: jest.fn(),
      activateAccount: jest.fn(),
      deleteAccount: jest.fn()
    };

    const controller = new CliproxyAccountController(service as never);

    await expect(
      controller.startOAuth({}, { authAdminId: 649624756 } as unknown as Request)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.startOAuth).not.toHaveBeenCalled();

    try {
      await controller.startOAuth({}, { authAdminId: 649624756 } as unknown as Request);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "APP_CLIPROXY_PROVIDER_UNSUPPORTED",
        message: "CLIProxy provider is unsupported.",
        hint: "Choose one of the supported CLIProxy providers and retry OAuth start."
      });
    }
  });

  test("forwards validated oauth completion payload", async () => {
    /* Completion endpoint should pass through explicit code/state payload after validation. */
    const service = {
      getState: jest.fn(),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn().mockResolvedValue(undefined),
      testAccount: jest.fn(),
      activateAccount: jest.fn(),
      deleteAccount: jest.fn()
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
      completeOAuth: jest.fn(),
      testAccount: jest.fn(),
      activateAccount: jest.fn(),
      deleteAccount: jest.fn()
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

  test("activates selected CLIProxy account", async () => {
    /* Controller should expose manual account switch for Mini App account cards. */
    const service = {
      getState: jest.fn(),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn(),
      testAccount: jest.fn(),
      activateAccount: jest.fn().mockResolvedValue(undefined),
      deleteAccount: jest.fn()
    };

    const controller = new CliproxyAccountController(service as never);
    const result = await controller.activateAccount(
      "codex-user@example.com",
      { authAdminId: 649624756 } as unknown as Request
    );

    expect(service.activateAccount).toHaveBeenCalledWith({ accountId: "codex-user@example.com" });
    expect(result).toEqual({ ok: true });
  });

  test("deletes selected CLIProxy account", async () => {
    /* Controller should allow removing obsolete auth files from the runtime pool. */
    const service = {
      getState: jest.fn(),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn(),
      testAccount: jest.fn().mockResolvedValue(undefined),
      activateAccount: jest.fn(),
      deleteAccount: jest.fn().mockResolvedValue(undefined)
    };

    const controller = new CliproxyAccountController(service as never);
    const result = await controller.deleteAccount(
      "codex-user@example.com",
      { authAdminId: 649624756 } as unknown as Request
    );

    expect(service.deleteAccount).toHaveBeenCalledWith({ accountId: "codex-user@example.com" });
    expect(result).toEqual({ ok: true });
  });

  test("tests selected CLIProxy account", async () => {
    /* Manual test action should reach backend service and refresh remote status for that auth file. */
    const service = {
      getState: jest.fn(),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn(),
      testAccount: jest.fn().mockResolvedValue(undefined),
      activateAccount: jest.fn(),
      deleteAccount: jest.fn()
    };

    const controller = new CliproxyAccountController(service as never);
    const result = await controller.testAccount(
      "codex-user@example.com",
      { authAdminId: 649624756 } as unknown as Request
    );

    expect(service.testAccount).toHaveBeenCalledWith({ accountId: "codex-user@example.com" });
    expect(result).toEqual({ ok: true });
  });

  test("rejects account mutation for traversal-like account id", async () => {
    /* Controller should block path-like ids before they reach runtime auth mutation flows. */
    const service = {
      getState: jest.fn(),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn(),
      testAccount: jest.fn(),
      activateAccount: jest.fn(),
      deleteAccount: jest.fn()
    };

    const controller = new CliproxyAccountController(service as never);

    await expect(
      controller.activateAccount("../codex-user@example.com", { authAdminId: 649624756 } as unknown as Request)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.activateAccount).not.toHaveBeenCalled();

    try {
      await controller.activateAccount("../codex-user@example.com", { authAdminId: 649624756 } as unknown as Request);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "APP_CLIPROXY_ACCOUNT_ID_INVALID",
        message: "CLIProxy account id contains forbidden path characters.",
        hint: "Use the exact account id from CLIProxy state and retry the action."
      });
    }
  });
});
