/**
 * @fileoverview Tests for CLIProxy account invalidation behavior.
 *
 * Test suites:
 * - useCliproxyAccounts - Verifies account mutations refresh both account state and provider summary.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiDelete, apiGet, apiPost } from "../../api/client";
import { useCliproxyAccounts } from "../use-cliproxy-accounts";

vi.mock("../../api/client", () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn()
}));

const cliproxyState = {
  providers: [{ id: "openai" as const, label: "OpenAI", connected: true, accounts: [] }],
  activeAccountId: null,
  updatedAt: "2026-03-22T12:00:00.000Z"
};

describe("useCliproxyAccounts", () => {
  beforeEach(() => {
    /* Clear API mocks so every account action assertion stays scoped to one mutation path. */
    vi.clearAllMocks();
  });

  it("refreshes provider summary after activating an account", async () => {
    /* Account activation changes top-level provider connectivity and should invalidate that summary immediately. */
    vi.mocked(apiPost).mockResolvedValueOnce({ ok: true });
    vi.mocked(apiGet).mockResolvedValueOnce(cliproxyState as any);
    const onAccountsChanged = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useCliproxyAccounts(vi.fn(), onAccountsChanged));

    await act(async () => {
      await result.current.activateAccount("account-1");
    });

    expect(apiPost).toHaveBeenCalledWith("/api/telegram/cliproxy/accounts/account-1/activate", {});
    expect(apiGet).toHaveBeenCalledWith("/api/telegram/cliproxy/state");
    expect(onAccountsChanged).toHaveBeenCalledTimes(1);
  });

  it("refreshes provider summary after deleting an account", async () => {
    /* Removing an account can change provider connected badges and must fan out beyond the local list. */
    vi.mocked(apiDelete).mockResolvedValueOnce({ ok: true });
    vi.mocked(apiGet).mockResolvedValueOnce(cliproxyState as any);
    const onAccountsChanged = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useCliproxyAccounts(vi.fn(), onAccountsChanged));

    await act(async () => {
      await result.current.deleteAccount("account-1");
    });

    expect(apiDelete).toHaveBeenCalledWith("/api/telegram/cliproxy/accounts/account-1");
    expect(apiGet).toHaveBeenCalledWith("/api/telegram/cliproxy/state");
    expect(onAccountsChanged).toHaveBeenCalledTimes(1);
  });
});
