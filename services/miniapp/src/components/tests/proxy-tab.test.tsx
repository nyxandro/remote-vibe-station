/**
 * @fileoverview UI tests for dedicated CLI/Proxy settings tab.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProxyTab } from "../ProxyTab";

describe("ProxyTab", () => {
  afterEach(() => {
    /* Reset DOM to keep role/label lookups deterministic between tests. */
    cleanup();
  });

  it("shows separate provider notice and allows switching to vless mode", () => {
    /* CLI/Proxy tab should not replace Providers tab and should persist proxy profile updates. */
    const onSave = vi.fn();
    const onApply = vi.fn();

    render(
      <ProxyTab
        snapshot={{
          mode: "direct",
          vlessProxyUrl: null,
          noProxy: "localhost,127.0.0.1,backend",
          updatedAt: "2026-03-06T11:00:00.000Z",
          envPreview: {
            HTTP_PROXY: null,
            HTTPS_PROXY: null,
            ALL_PROXY: null,
            NO_PROXY: "localhost,127.0.0.1,backend"
          },
          runtimeFiles: {
            runtimeConfigDir: "/runtime-config",
            proxyEnvPath: "/runtime-config/infra/vless/proxy.env",
            overridePath: "/runtime-config/docker-compose.vless.yml",
            recommendedApplyCommand:
              "docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml up -d"
          }
        }}
        isLoading={false}
        isSaving={false}
        isApplying={false}
        applyResult={null}
        onReload={vi.fn()}
        onSave={onSave}
        onApply={onApply}
      />
    );

    expect(screen.getByText("Используйте вкладку Providers для подключения моделей напрямую (без CLIProxy)."))
      .toBeTruthy();

    fireEvent.change(screen.getByLabelText("Outbound mode"), { target: { value: "vless" } });
    fireEvent.change(screen.getByLabelText("VLESS proxy URL"), {
      target: { value: "socks5://vless-proxy:1080" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save proxy settings" }));

    expect(onSave).toHaveBeenCalledWith({
      mode: "vless",
      vlessProxyUrl: "socks5://vless-proxy:1080",
      noProxy: "localhost,127.0.0.1,backend"
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply runtime now" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
