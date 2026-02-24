/**
 * @fileoverview Tests for TelegramProviderController provider-connect endpoints.
 */

import { Request } from "express";

import { TelegramProviderController } from "../telegram-provider.controller";

describe("TelegramProviderController", () => {
  const buildController = () => {
    /* Keep OpenCode and preferences collaborators explicit for endpoint contracts. */
    const opencode = {
      listProviderAuthMethods: jest.fn().mockResolvedValue({
        openai: [{ type: "oauth", label: "ChatGPT Pro" }, { type: "api", label: "API key" }]
      }),
      authorizeOAuth: jest.fn().mockResolvedValue({
        url: "https://provider.example/auth",
        method: "code",
        instructions: "Paste auth code"
      }),
      completeOAuth: jest.fn().mockResolvedValue(true),
      setApiKey: jest.fn().mockResolvedValue(undefined),
      disconnectProvider: jest.fn().mockResolvedValue(undefined)
    };

    const preferences = {
      getSettings: jest.fn().mockResolvedValue({
        selected: {
          model: { providerID: "openai", modelID: "gpt-5" },
          thinking: "high",
          agent: "build"
        },
        providers: [{ id: "openai", name: "OpenAI", connected: true, defaultModelID: "gpt-5" }],
        models: [{ id: "gpt-5", name: "GPT-5", variants: ["high"] }],
        agents: [{ name: "build", description: "Build" }],
        thinkingOptions: ["high"]
      })
    };

    const controller = new TelegramProviderController(opencode as never, preferences as never);
    return { controller, opencode, preferences };
  };

  test("returns providers snapshot with selected mode details", async () => {
    /* Mini App tab should render connected providers and selected execution mode. */
    const { controller, opencode, preferences } = buildController();

    const result = await controller.getProviderOverview({ authAdminId: 649624756 } as unknown as Request);

    expect(preferences.getSettings).toHaveBeenCalledWith(649624756);
    expect(opencode.listProviderAuthMethods).toHaveBeenCalledTimes(1);
    expect(result.selected.model.providerID).toBe("openai");
    expect(result.authMethods.openai).toHaveLength(2);
  });

  test("initiates OAuth authorization", async () => {
    /* Provider connect modal must receive URL and completion method for OAuth flow. */
    const { controller, opencode } = buildController();

    const result = await controller.authorizeOAuth(
      { providerID: "openai", method: 0 },
      { authAdminId: 649624756 } as unknown as Request
    );

    expect(opencode.authorizeOAuth).toHaveBeenCalledWith({ providerID: "openai", method: 0 });
    expect(result).toEqual({
      ok: true,
      url: "https://provider.example/auth",
      method: "code",
      instructions: "Paste auth code"
    });
  });

  test("stores provider API key", async () => {
    /* Manual-key providers should be connected via secure backend proxy endpoint. */
    const { controller, opencode } = buildController();

    const result = await controller.setApiKey(
      { providerID: "openai", key: "test-api-key-123" },
      { authAdminId: 649624756 } as unknown as Request
    );

    expect(opencode.setApiKey).toHaveBeenCalledWith({ providerID: "openai", key: "test-api-key-123" });
    expect(result).toEqual({ ok: true });
  });
});
