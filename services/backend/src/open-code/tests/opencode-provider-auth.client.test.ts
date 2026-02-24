/**
 * @fileoverview Tests for OpenCodeProviderAuthClient auth operations.
 */

import { OpenCodeProviderAuthClient } from "../opencode-provider-auth.client";

const baseConfig = {
  telegramBotToken: "token",
  adminIds: [1],
  publicBaseUrl: "https://example.com",
  publicDomain: "example.com",
  projectsRoot: "/srv/projects",
  opencodeServerUrl: "http://opencode:4096",
  opencodeSyncOnStart: false,
  opencodeWarmRecentsOnStart: false,
  opencodeWarmRecentsLimit: 0
} as any;

describe("OpenCodeProviderAuthClient", () => {
  beforeEach(() => {
    /* Keep HTTP mock isolated between test cases. */
    jest.restoreAllMocks();
  });

  it("lists provider authentication methods", async () => {
    /* Provider connect UI needs oauth/api method descriptors from runtime. */
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ openai: [{ type: "oauth", label: "ChatGPT" }] })
    } as Response);

    const client = new OpenCodeProviderAuthClient(baseConfig);
    const methods = await client.listProviderAuthMethods();

    expect(methods).toEqual({ openai: [{ type: "oauth", label: "ChatGPT" }] });
    expect(fetchMock).toHaveBeenCalledWith("http://opencode:4096/provider/auth", expect.any(Object));
  });

  it("starts OAuth flow and returns authorization payload", async () => {
    /* OAuth providers require URL and method details before user redirect. */
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          url: "https://provider.example/auth",
          method: "code",
          instructions: "Paste code"
        })
    } as Response);

    const client = new OpenCodeProviderAuthClient(baseConfig);
    const payload = await client.authorizeOAuth({ providerID: "openai", method: 1 });

    expect(payload).toEqual({
      url: "https://provider.example/auth",
      method: "code",
      instructions: "Paste code"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://opencode:4096/provider/openai/oauth/authorize",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ method: 1 }) })
    );
  });

  it("stores API key credentials", async () => {
    /* Manual API providers should be connectable without OAuth browser loop. */
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      text: async () => "true"
    } as Response);

    const client = new OpenCodeProviderAuthClient(baseConfig);
    await client.setApiKey({ providerID: "openai", key: "test-api-key-123" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://opencode:4096/auth/openai",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ type: "api", key: "test-api-key-123" })
      })
    );
  });
});
