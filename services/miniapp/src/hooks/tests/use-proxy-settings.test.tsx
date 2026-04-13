/**
 * @fileoverview Tests for proxy settings runtime apply behavior.
 *
 * Test suites:
 * - useProxySettings - Verifies apply invalidates the persisted runtime snapshot after success.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiPost } from "../../api/client";
import { useProxySettings } from "../use-proxy-settings";

vi.mock("../../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn()
}));

const proxySnapshot = {
  mode: "direct" as const,
  vlessProxyUrl: null,
  vlessConfigUrl: null,
  enabledServices: ["bot", "cliproxy", "opencode"],
  updatedAt: "2026-03-22T12:00:00.000Z",
  envPreview: {
    HTTP_PROXY: null,
    HTTPS_PROXY: null,
    ALL_PROXY: null,
    NO_PROXY: "localhost,127.0.0.1"
  },
  runtimeFiles: {
    runtimeConfigDir: "/srv/runtime",
    proxyEnvPath: "/srv/runtime/proxy.env",
    overridePath: "/srv/runtime/docker-compose.override.yml",
    recommendedApplyCommand: "docker compose up -d"
  }
};

describe("useProxySettings", () => {
  beforeEach(() => {
    /* Keep apply-flow assertions isolated from previous runtime snapshot mocks. */
    vi.clearAllMocks();
  });

  it("reloads proxy settings after applying the runtime", async () => {
    /* Apply can change generated runtime metadata, so the persisted snapshot must be re-read immediately. */
    vi.mocked(apiPost).mockResolvedValueOnce({ ok: true, appliedAt: "2026-03-22T12:00:01.000Z" });
    vi.mocked(apiGet).mockResolvedValueOnce(proxySnapshot);

    const { result } = renderHook(() => useProxySettings(vi.fn()));

    await act(async () => {
      await result.current.applySettings();
    });

    expect(apiPost).toHaveBeenCalledWith("/api/telegram/proxy/settings/apply", {});
    expect(apiGet).toHaveBeenCalledWith("/api/telegram/proxy/settings");
    expect(result.current.snapshot?.runtimeFiles.proxyEnvPath).toBe("/srv/runtime/proxy.env");
  });

  it("tests vless config url before saving", async () => {
    /* Mini App should expose explicit pre-save validation for pasted config URLs. */
    vi.mocked(apiPost).mockResolvedValueOnce({
      ok: true,
      vlessProxyUrl: "http://vless-proxy:8080",
      summary: "example.com:443 via reality"
    });

    const { result } = renderHook(() => useProxySettings(vi.fn()));

    await act(async () => {
      await result.current.testSettings({
        vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality#demo"
      });
    });

    expect(apiPost).toHaveBeenCalledWith("/api/telegram/proxy/settings/test", {
      vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality#demo"
    });
    expect(result.current.testResult?.vlessProxyUrl).toBe("http://vless-proxy:8080");
  });
});
