/**
 * @fileoverview Tests for CLIProxy account onboarding service.
 */

import { BadRequestException } from "@nestjs/common";

import { CliproxyAccountService } from "../cliproxy-account.service";

describe("CliproxyAccountService", () => {
  test("builds provider statuses from auth files and api-key config", async () => {
    /* Account status should reflect both oauth auth-files and api-key config entries. */
    const api = {
      getAuthFiles: jest.fn().mockResolvedValue(["codex-abc.json", "anthropic-main.json"]),
      getConfig: jest.fn().mockResolvedValue({
        "codex-api-key": "sk-codex",
        "claude-api-key": null,
        "gemini-api-key": null,
        "vertex-api-key": null
      }),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn()
    };

    const service = new CliproxyAccountService(api as never);
    const state = await service.getState();

    expect(state.providers.find((item: { id: string }) => item.id === "codex")?.connected).toBe(true);
    expect(state.providers.find((item: { id: string }) => item.id === "anthropic")?.connected).toBe(true);
    expect(state.providers.find((item: { id: string }) => item.id === "qwen")?.connected).toBe(false);
    expect(state.authFiles).toEqual(["codex-abc.json", "anthropic-main.json"]);
  });

  test("extracts callback params from full URL for oauth completion", async () => {
    /* Users should be able to paste full browser callback URL instead of splitting fields manually. */
    const api = {
      getAuthFiles: jest.fn().mockResolvedValue([]),
      getConfig: jest.fn().mockResolvedValue({}),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn().mockResolvedValue(undefined)
    };

    const service = new CliproxyAccountService(api as never);

    await service.completeOAuth({
      provider: "codex",
      callbackUrl: "http://localhost:1455/auth/callback?code=abc123&state=state987"
    });

    expect(api.completeOAuth).toHaveBeenCalledWith({
      provider: "codex",
      code: "abc123",
      state: "state987",
      error: undefined
    });
  });

  test("fails fast when callback URL has no code/state", async () => {
    /* Missing callback params must return explicit validation error for operator guidance. */
    const api = {
      getAuthFiles: jest.fn().mockResolvedValue([]),
      getConfig: jest.fn().mockResolvedValue({}),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn().mockResolvedValue(undefined)
    };

    const service = new CliproxyAccountService(api as never);

    await expect(
      service.completeOAuth({
        provider: "codex",
        callbackUrl: "http://localhost:1455/auth/callback?foo=bar"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
