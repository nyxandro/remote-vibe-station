/**
 * @fileoverview Tests for CLIProxy account onboarding service.
 */

import { BadGatewayException, BadRequestException } from "@nestjs/common";

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
          path: "/root/.cli-proxy-api/codex-user@example.com.json",
          source: "file",
          runtimeOnly: false,
          disabled: false,
          unavailable: false,
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
          path: "/root/.cli-proxy-api/claude-user@example.com.json",
          source: "file",
          runtimeOnly: false,
          disabled: true,
          unavailable: false,
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
      apiCall: jest.fn().mockImplementation(async (input: { url: string }) => {
        if (input.url === "https://api.anthropic.com/api/oauth/usage") {
          return {
            statusCode: 200,
            body: {
              five_hour: {
                utilization: 25,
                resets_at: "2026-03-06T15:00:00.000Z"
              },
              seven_day: {
                utilization: 40,
                resets_at: "2026-03-10T15:00:00.000Z"
              }
            },
            bodyText: ""
          };
        }

        if (input.url === "https://api.anthropic.com/api/oauth/profile") {
          return {
            statusCode: 200,
            body: {
              account: {
                has_claude_pro: true
              }
            },
            bodyText: ""
          };
        }

        throw new Error(`Unexpected apiCall URL: ${input.url}`);
      }),
      downloadAuthFileJson: jest.fn().mockImplementation(async (name: string) => {
        if (name === "codex-user@example.com") {
          return {
            id_token: {
              chatgpt_account_id: "chatgpt-account-1"
            }
          };
        }

        return {};
      }),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn()
    };
    const runtime = {
      setDisabled: jest.fn(),
      deleteFile: jest.fn()
    };
    const liveQuotaLoader = jest.fn().mockImplementation(async (entry, provider) => {
      if (provider === "anthropic") {
        return {
          mode: "live",
          planType: "pro",
          windows: [
            {
              id: "five-hour",
              label: "5 часов",
              remainingPercent: 75,
              resetAt: "2026-03-06T15:00:00.000Z",
              resetAfterSeconds: null
            },
            {
              id: "seven-day",
              label: "7 дней",
              remainingPercent: 60,
              resetAt: "2026-03-10T15:00:00.000Z",
              resetAfterSeconds: null
            }
          ]
        };
      }

      if (provider === "codex") {
        return {
          mode: "live",
          planType: "plus",
          windows: [
            {
              id: "five-hour",
              label: "5 часов",
              remainingPercent: 65,
              resetAt: null,
              resetAfterSeconds: 3600
            },
            {
              id: "weekly",
              label: "7 дней",
              remainingPercent: 80,
              resetAt: null,
              resetAfterSeconds: 172800
            }
          ]
        };
      }

      return null;
    });

    const service = new CliproxyAccountService(api as never, runtime as never);
    (service as unknown as { liveQuotaLoader: unknown }).liveQuotaLoader = liveQuotaLoader;
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
        disabled: true,
        unavailable: false,
        canManage: true,
        status: "ready",
        statusMessage: "ok",
        quota: {
          mode: "live",
          planType: "pro",
          windows: [
            {
              id: "five-hour",
              label: "5 часов",
              remainingPercent: 75,
              resetAt: "2026-03-06T15:00:00.000Z",
              resetAfterSeconds: null
            },
            {
              id: "seven-day",
              label: "7 дней",
              remainingPercent: 60,
              resetAt: "2026-03-10T15:00:00.000Z",
              resetAfterSeconds: null
            }
          ]
        },
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
        disabled: false,
        unavailable: false,
        canManage: true,
        status: "ready",
        statusMessage: "ok",
        quota: {
          mode: "live",
          planType: "plus",
          windows: [
            {
              id: "five-hour",
              label: "5 часов",
              remainingPercent: 65,
              resetAt: null,
              resetAfterSeconds: 3600
            },
            {
              id: "weekly",
              label: "7 дней",
              remainingPercent: 80,
              resetAt: null,
              resetAfterSeconds: 172800
            }
          ]
        },
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

  test("keeps account state available when CLIProxy usage endpoint is missing", async () => {
    /* Newer CLIProxy builds can omit historical usage telemetry; provider management must still load. */
    const api = {
      getAuthFiles: jest.fn().mockResolvedValue([
        {
          id: "codex-user@example.com",
          name: "codex-user@example.com",
          authIndex: "codex-1",
          provider: "codex",
          path: "/root/.cli-proxy-api/codex-user@example.com.json",
          source: "file",
          runtimeOnly: false,
          disabled: false,
          unavailable: false,
          email: "codex-user@example.com",
          account: null,
          label: null,
          status: "ready",
          statusMessage: "ok"
        }
      ]),
      getConfig: jest.fn().mockResolvedValue({}),
      getUsageStatisticsEnabled: jest.fn().mockResolvedValue(true),
      getUsage: jest.fn().mockRejectedValue(
        new BadGatewayException("CLIProxy management request failed (404) at '/v0/management/usage': 404 page not found")
      ),
      apiCall: jest.fn(),
      downloadAuthFileJson: jest.fn().mockResolvedValue({}),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn()
    };
    const runtime = {
      setDisabled: jest.fn(),
      deleteFile: jest.fn()
    };

    const service = new CliproxyAccountService(api as never, runtime as never);
    const state = await service.getState();

    expect(state.usageTrackingEnabled).toBe(true);
    expect(state.providers.find((item: { id: string }) => item.id === "codex")?.connected).toBe(true);
    expect(state.accounts[0]?.usage).toEqual({
      requestCount: 0,
      tokenCount: 0,
      failedRequestCount: 0,
      models: [],
      lastUsedAt: null
    });
  });

  test("extracts callback params from full URL for oauth completion", async () => {
    /* Users should be able to paste full browser callback URL instead of splitting fields manually. */
    const api = {
      getAuthFiles: jest.fn().mockResolvedValue([]),
      getConfig: jest.fn().mockResolvedValue({}),
      startOAuth: jest.fn(),
      completeOAuth: jest.fn().mockResolvedValue(undefined)
    };
    const runtime = {
      setDisabled: jest.fn(),
      deleteFile: jest.fn()
    };

    const service = new CliproxyAccountService(api as never, runtime as never);

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
    const runtime = {
      setDisabled: jest.fn(),
      deleteFile: jest.fn()
    };

    const service = new CliproxyAccountService(api as never, runtime as never);

    await expect(
      service.completeOAuth({
        provider: "codex",
        callbackUrl: "http://localhost:1455/auth/callback?foo=bar"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test("activates selected account and disables provider siblings", async () => {
    /* Manual account switch should pin one enabled auth file per provider. */
    const api = {
      getAuthFiles: jest.fn().mockResolvedValue([
        {
          id: "codex-a",
          name: "codex-a",
          authIndex: "codex-1",
          provider: "codex",
          path: "/root/.cli-proxy-api/codex-a.json",
          source: "file",
          runtimeOnly: false,
          disabled: false,
          unavailable: false,
          email: "a@example.com",
          account: null,
          label: null,
          status: "active",
          statusMessage: ""
        },
        {
          id: "codex-b",
          name: "codex-b",
          authIndex: "codex-2",
          provider: "codex",
          path: "/root/.cli-proxy-api/codex-b.json",
          source: "file",
          runtimeOnly: false,
          disabled: true,
          unavailable: false,
          email: "b@example.com",
          account: null,
          label: null,
          status: "ready",
          statusMessage: ""
        },
        {
          id: "claude-a",
          name: "claude-a",
          authIndex: "claude-1",
          provider: "claude",
          path: "/root/.cli-proxy-api/claude-a.json",
          source: "file",
          runtimeOnly: false,
          disabled: false,
          unavailable: false,
          email: null,
          account: null,
          label: null,
          status: "ready",
          statusMessage: ""
        }
      ])
    };
    const runtime = {
      setDisabled: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn()
    };

    const service = new CliproxyAccountService(api as never, runtime as never);
    await service.activateAccount({ accountId: "codex-b" });

    expect(runtime.setDisabled).toHaveBeenCalledTimes(2);
    expect(runtime.setDisabled).toHaveBeenNthCalledWith(1, {
      filePath: "/root/.cli-proxy-api/codex-b.json",
      disabled: false
    });
    expect(runtime.setDisabled).toHaveBeenNthCalledWith(2, {
      filePath: "/root/.cli-proxy-api/codex-a.json",
      disabled: true
    });
  });

  test("rolls back account activation mutations when sibling update fails", async () => {
    /* Partial runtime failure should restore already-mutated auth files to their original disabled flags. */
    const api = {
      getAuthFiles: jest.fn().mockResolvedValue([
        {
          id: "codex-a",
          name: "codex-a",
          authIndex: "codex-1",
          provider: "codex",
          path: "/root/.cli-proxy-api/codex-a.json",
          source: "file",
          runtimeOnly: false,
          disabled: false,
          unavailable: false,
          email: "a@example.com",
          account: null,
          label: null,
          status: "active",
          statusMessage: ""
        },
        {
          id: "codex-b",
          name: "codex-b",
          authIndex: "codex-2",
          provider: "codex",
          path: "/root/.cli-proxy-api/codex-b.json",
          source: "file",
          runtimeOnly: false,
          disabled: true,
          unavailable: false,
          email: "b@example.com",
          account: null,
          label: null,
          status: "ready",
          statusMessage: ""
        }
      ])
    };
    const runtime = {
      setDisabled: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("disable failed"))
        .mockResolvedValueOnce(undefined),
      deleteFile: jest.fn()
    };

    const service = new CliproxyAccountService(api as never, runtime as never);

    await expect(service.activateAccount({ accountId: "codex-b" })).rejects.toThrow("disable failed");
    expect(runtime.setDisabled).toHaveBeenNthCalledWith(1, {
      filePath: "/root/.cli-proxy-api/codex-b.json",
      disabled: false
    });
    expect(runtime.setDisabled).toHaveBeenNthCalledWith(2, {
      filePath: "/root/.cli-proxy-api/codex-a.json",
      disabled: true
    });
    expect(runtime.setDisabled).toHaveBeenNthCalledWith(3, {
      filePath: "/root/.cli-proxy-api/codex-b.json",
      disabled: true
    });
  });

  test("deletes selected account and re-enables remaining sibling when needed", async () => {
    /* Removing the active auth file should not leave the provider with only disabled leftovers. */
    const api = {
      getAuthFiles: jest.fn().mockResolvedValue([
        {
          id: "codex-a",
          name: "codex-a",
          authIndex: "codex-1",
          provider: "codex",
          path: "/root/.cli-proxy-api/codex-a.json",
          source: "file",
          runtimeOnly: false,
          disabled: false,
          unavailable: false,
          email: null,
          account: null,
          label: null,
          status: "active",
          statusMessage: ""
        },
        {
          id: "codex-b",
          name: "codex-b",
          authIndex: "codex-2",
          provider: "codex",
          path: "/root/.cli-proxy-api/codex-b.json",
          source: "file",
          runtimeOnly: false,
          disabled: true,
          unavailable: false,
          email: null,
          account: null,
          label: null,
          status: "ready",
          statusMessage: ""
        }
      ])
    };
    const runtime = {
      setDisabled: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined)
    };

    const service = new CliproxyAccountService(api as never, runtime as never);
    await service.deleteAccount({ accountId: "codex-a" });

    expect(runtime.setDisabled).toHaveBeenCalledWith({
      filePath: "/root/.cli-proxy-api/codex-b.json",
      disabled: false
    });
    expect(runtime.deleteFile).toHaveBeenCalledWith({ filePath: "/root/.cli-proxy-api/codex-a.json" });
  });

  test("tests selected account with temporary provider switch and restores original flags", async () => {
    /* Test action must send a real lightweight request through the chosen account and then restore routing. */
    const api = {
      getAuthFiles: jest.fn().mockResolvedValue([
        {
          id: "codex-a",
          name: "codex-a",
          authIndex: "codex-1",
          provider: "codex",
          path: "/root/.cli-proxy-api/codex-a.json",
          source: "file",
          runtimeOnly: false,
          disabled: false,
          unavailable: false,
          email: null,
          account: null,
          label: null,
          status: "active",
          statusMessage: ""
        },
        {
          id: "codex-b",
          name: "codex-b",
          authIndex: "codex-2",
          provider: "codex",
          path: "/root/.cli-proxy-api/codex-b.json",
          source: "file",
          runtimeOnly: false,
          disabled: true,
          unavailable: true,
          email: null,
          account: null,
          label: null,
          status: "error",
          statusMessage: "usage limit reached"
        }
      ]),
      getUsage: jest.fn().mockResolvedValue([
        {
          model: "gpt-5.4",
          authIndex: "codex-2",
          timestamp: "2026-03-10T10:05:00.000Z",
          failed: true,
          totalTokens: 120
        }
      ]),
      listModels: jest.fn().mockResolvedValue(["gpt-5.4", "gpt-5.4-mini"]),
      runChatProbe: jest.fn().mockResolvedValue(undefined)
    };
    const runtime = {
      setDisabled: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn()
    };

    const service = new CliproxyAccountService(api as never, runtime as never);
    await service.testAccount({ accountId: "codex-b" });

    expect(runtime.setDisabled).toHaveBeenNthCalledWith(1, {
      filePath: "/root/.cli-proxy-api/codex-b.json",
      disabled: false
    });
    expect(runtime.setDisabled).toHaveBeenNthCalledWith(2, {
      filePath: "/root/.cli-proxy-api/codex-a.json",
      disabled: true
    });
    expect(api.listModels).toHaveBeenCalledTimes(1);
    expect(api.runChatProbe).toHaveBeenCalledWith({ modelID: "gpt-5.4" });
    expect(runtime.setDisabled).toHaveBeenNthCalledWith(3, {
      filePath: "/root/.cli-proxy-api/codex-a.json",
      disabled: false
    });
    expect(runtime.setDisabled).toHaveBeenNthCalledWith(4, {
      filePath: "/root/.cli-proxy-api/codex-b.json",
      disabled: true
    });
  });

  test("tests selected account when CLIProxy usage endpoint is missing", async () => {
    /* Probe model selection should fall back to provider defaults when historical usage telemetry is unavailable. */
    const api = {
      getAuthFiles: jest.fn().mockResolvedValue([
        {
          id: "codex-a",
          name: "codex-a",
          authIndex: "codex-1",
          provider: "codex",
          path: "/root/.cli-proxy-api/codex-a.json",
          source: "file",
          runtimeOnly: false,
          disabled: false,
          unavailable: false,
          email: null,
          account: null,
          label: null,
          status: "ready",
          statusMessage: ""
        }
      ]),
      getUsage: jest.fn().mockRejectedValue(
        new BadGatewayException("CLIProxy management request failed (404) at '/v0/management/usage': 404 page not found")
      ),
      listModels: jest.fn().mockResolvedValue(["gpt-5.4-mini"]),
      runChatProbe: jest.fn().mockResolvedValue(undefined)
    };
    const runtime = {
      setDisabled: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn()
    };

    const service = new CliproxyAccountService(api as never, runtime as never);
    await service.testAccount({ accountId: "codex-a" });

    expect(api.runChatProbe).toHaveBeenCalledWith({ modelID: "gpt-5.4-mini" });
  });
});
