/**
 * @fileoverview Tests for live CLIProxy quota loader helpers.
 */

import { loadCliproxyLiveQuota } from "../cliproxy-live-quota";

describe("loadCliproxyLiveQuota", () => {
  test("loads codex quota through downloaded access token and backend proxy fetcher", async () => {
    /* Codex live quota should come from direct upstream usage calls because management api-call can be proxy-blind. */
    const result = await loadCliproxyLiveQuota(
      {
        id: "codex-user@example.com",
        authIndex: "codex-1",
        name: "codex-user@example.com",
        provider: "codex",
        path: "/root/.cli-proxy-api/codex-user@example.com.json",
        source: "file",
        runtimeOnly: false,
        disabled: false,
        unavailable: false,
        label: null,
        status: "ready",
        statusMessage: null,
        email: "codex-user@example.com",
        account: null,
        metadata: null,
        attributes: null,
        idToken: null,
        planType: null
      },
      "codex",
      {
        api: {
          apiCall: jest.fn(),
          downloadAuthFileJson: jest.fn().mockResolvedValue({
            access_token: "codex-access-token",
            id_token: {
              chatgpt_account_id: "chatgpt-account-1"
            }
          })
        } as never,
        fetchCodexUsage: jest.fn().mockResolvedValue({
          plan_type: "plus",
          rate_limit: {
            primary_window: {
              used_percent: 37,
              limit_window_seconds: 18_000,
              reset_after_seconds: 9_248,
              reset_at: 1_773_693_773
            },
            secondary_window: {
              used_percent: 33,
              limit_window_seconds: 604_800,
              reset_after_seconds: 173_795,
              reset_at: 1_773_858_321
            }
          }
        })
      }
    );

    expect(result).toEqual({
      mode: "live",
      planType: "plus",
      windows: [
        {
          id: "five-hour",
          label: "5 часов",
          remainingPercent: 63,
          resetAt: "2026-03-16T20:42:53.000Z",
          resetAfterSeconds: 9248
        },
        {
          id: "weekly",
          label: "7 дней",
          remainingPercent: 67,
          resetAt: "2026-03-18T18:25:21.000Z",
          resetAfterSeconds: 173795
        }
      ]
    });
  });

  test("returns null for codex account without access token", async () => {
    /* Missing access token should fail fast to the fallback UI instead of sending incomplete upstream requests. */
    const result = await loadCliproxyLiveQuota(
      {
        id: "codex-user@example.com",
        authIndex: "codex-1",
        name: "codex-user@example.com",
        provider: "codex",
        path: "/root/.cli-proxy-api/codex-user@example.com.json",
        source: "file",
        runtimeOnly: false,
        disabled: false,
        unavailable: false,
        label: null,
        status: "ready",
        statusMessage: null,
        email: "codex-user@example.com",
        account: null,
        metadata: null,
        attributes: null,
        idToken: null,
        planType: null
      },
      "codex",
      {
        api: {
          apiCall: jest.fn(),
          downloadAuthFileJson: jest.fn().mockResolvedValue({
            id_token: {
              chatgpt_account_id: "chatgpt-account-1"
            }
          })
        } as never,
        fetchCodexUsage: jest.fn()
      }
    );

    expect(result).toBeNull();
  });

  test("reads codex account id from downloaded jwt auth claim payload", async () => {
    /* Downloaded auth files store ChatGPT account id inside the OpenAI auth claim, so the resolver must support that shape. */
    const jwtPayload = Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "chatgpt-account-from-jwt"
        }
      }),
      "utf8"
    )
      .toString("base64url");

    const result = await loadCliproxyLiveQuota(
      {
        id: "codex-user@example.com",
        authIndex: "codex-1",
        name: "codex-user@example.com",
        provider: "codex",
        path: "/root/.cli-proxy-api/codex-user@example.com.json",
        source: "file",
        runtimeOnly: false,
        disabled: false,
        unavailable: false,
        label: null,
        status: "ready",
        statusMessage: null,
        email: "codex-user@example.com",
        account: null,
        metadata: null,
        attributes: null,
        idToken: null,
        planType: null
      },
      "codex",
      {
        api: {
          apiCall: jest.fn(),
          downloadAuthFileJson: jest.fn().mockResolvedValue({
            access_token: "codex-access-token",
            id_token: `header.${jwtPayload}.signature`
          })
        } as never,
        fetchCodexUsage: jest.fn().mockResolvedValue({
          plan_type: "plus",
          rate_limit: {
            primary_window: {
              used_percent: 10,
              limit_window_seconds: 18_000,
              reset_after_seconds: 3_600
            }
          }
        })
      }
    );

    expect(result?.windows[0]?.remainingPercent).toBe(90);
  });
});
