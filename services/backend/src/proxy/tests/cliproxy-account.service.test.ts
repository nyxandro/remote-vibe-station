/**
 * @fileoverview Tests for CLIProxy account onboarding service.
 */

import { BadRequestException } from "@nestjs/common";

import { CliproxyAccountService } from "../cliproxy-account.service";

describe("CliproxyAccountService", () => {
  test("builds provider statuses and normalized connected accounts from auth files", async () => {
    /* Account state should surface both provider connectivity, concrete identities, and observed per-account usage. */
    const api = {
      getAuthFiles: jest.fn().mockResolvedValue([
        {
          id: "codex-user@example.com",
          name: "codex-user@example.com",
          authIndex: "codex-1",
          provider: "codex",
          email: "codex-user@example.com",
          account: "workspace-1",
          status: "ready",
          statusMessage: "ok",
          label: null
        },
        {
          id: "claude-user@example.com",
          name: "claude-user@example.com",
          authIndex: "claude-1",
          provider: "claude",
          email: "claude-user@example.com",
          account: "team-prod",
          label: "Claude Prod",
          status: "ready",
          statusMessage: "ok"
        }
      ]),
      getConfig: jest.fn().mockResolvedValue({
        "codex-api-key": "sk-codex",
        "claude-api-key": null,
        "gemini-api-key": null,
        "vertex-api-key": null
      }),
      getUsageStatisticsEnabled: jest.fn().mockResolvedValue(true),
      getUsage: jest.fn().mockResolvedValue([
        {
          model: "gpt-5.4",
          authIndex: "codex-1",
          timestamp: "2026-03-06T10:05:00.000Z",
          failed: false,
          totalTokens: 400
        },
        {
          model: "gpt-5.4",
          authIndex: "claude-1",
          timestamp: "2026-03-06T10:06:00.000Z",
          failed: true,
          totalTokens: 300
        },
        {
          model: "claude-sonnet-4-5",
          authIndex: "codex-1",
          timestamp: "2026-03-06T10:07:00.000Z",
          failed: false,
          totalTokens: 200
        }
      ]),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn()
    };

    const service = new CliproxyAccountService(api as never);
    const state = await service.getState();

    expect(state.providers.find((item: { id: string }) => item.id === "codex")?.connected).toBe(true);
    expect(state.providers.find((item: { id: string }) => item.id === "anthropic")?.connected).toBe(true);
    expect(state.providers.find((item: { id: string }) => item.id === "qwen")?.connected).toBe(false);
    expect(state.usageTrackingEnabled).toBe(true);
    expect(state.accounts).toEqual([
      {
        id: "claude-user@example.com",
        provider: "anthropic",
        providerLabel: "Claude",
        name: "claude-user@example.com",
        email: "claude-user@example.com",
        account: "team-prod",
        label: "Claude Prod",
        status: "ready",
        statusMessage: "ok",
        usage: {
          requestCount: 1,
          tokenCount: 300,
          failedRequestCount: 1,
          models: ["gpt-5.4"],
          lastUsedAt: "2026-03-06T10:06:00.000Z"
        }
      },
      {
        id: "codex-user@example.com",
        provider: "codex",
        providerLabel: "Codex",
        name: "codex-user@example.com",
        email: "codex-user@example.com",
        account: "workspace-1",
        label: null,
        status: "ready",
        statusMessage: "ok",
        usage: {
          requestCount: 2,
          tokenCount: 600,
          failedRequestCount: 0,
          models: ["claude-sonnet-4-5", "gpt-5.4"],
          lastUsedAt: "2026-03-06T10:07:00.000Z"
        }
      }
    ]);
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
