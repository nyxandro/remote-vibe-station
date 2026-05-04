/**
 * @fileoverview Tests for OpenCode provider onboarding hook.
 *
 * Test suites:
 * - useProviderAuth - Verifies generic OpenCode providers can fall back to API-key onboarding.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useProviderAuth } from "../use-provider-auth";

vi.mock("../../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn()
}));

describe("useProviderAuth", () => {
  beforeEach(() => {
    /* Reset hook API mocks between scenarios so fallback state assertions stay isolated. */
    vi.clearAllMocks();
  });

  it("opens API-key flow for providers without explicit OpenCode auth methods", async () => {
    /* OpenCode /provider/auth only lists special providers; generic providers are still configured via /auth/:id API key. */
    const { result } = renderHook(() => useProviderAuth(vi.fn()));

    await act(async () => {
      await result.current.startConnect({ providerID: "deepseek", methodIndex: 0 });
    });

    expect(result.current.oauthState).toEqual({
      providerID: "deepseek",
      methodIndex: 0,
      method: "code",
      url: "",
      instructions: "api",
      codeDraft: ""
    });
  });
});
