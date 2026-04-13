/**
 * @fileoverview Tests for CLI/Proxy settings controller contracts.
 */

import { BadRequestException } from "@nestjs/common";
import { Request } from "express";

import { ProxySettingsController } from "../proxy-settings.controller";

describe("ProxySettingsController", () => {
  test("returns current proxy settings snapshot", async () => {
    /* Mini App should receive both values and export-ready env preview. */
    const service = {
      getSettings: jest.fn().mockResolvedValue({
        mode: "direct",
        vlessProxyUrl: null,
        vlessConfigUrl: null,
        enabledServices: ["bot", "cliproxy", "opencode"],
        noProxy: "localhost,127.0.0.1,backend,bot,miniapp,opencode,cliproxy,proxy,vless-proxy",
        updatedAt: "2026-03-06T10:40:00.000Z",
        envPreview: {
          HTTP_PROXY: null,
          HTTPS_PROXY: null,
          ALL_PROXY: null,
          NO_PROXY: "localhost,127.0.0.1,backend,bot,miniapp,opencode,cliproxy,proxy,vless-proxy"
        }
      })
    };

    const controller = new ProxySettingsController(service as never, { publish: jest.fn() } as never);
    const result = await controller.getSettings({ authAdminId: 649624756 } as unknown as Request);

    expect(service.getSettings).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe("direct");
    expect(result.envPreview.NO_PROXY).toContain("backend");
  });

  test("saves proxy settings payload", async () => {
    /* Save endpoint must pass validated mode/url/service selection and let the service derive NO_PROXY. */
    const service = {
      getSettings: jest.fn(),
      applyRuntimeStack: jest.fn(),
      updateSettings: jest.fn().mockResolvedValue({
        mode: "vless",
        vlessProxyUrl: "socks5://vless-proxy:1080",
        vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality#demo",
        enabledServices: ["bot", "cliproxy"],
        noProxy: "localhost,127.0.0.1,backend,bot,miniapp,opencode,cliproxy,proxy,vless-proxy",
        updatedAt: "2026-03-06T10:41:00.000Z",
        envPreview: {
          HTTP_PROXY: "socks5://vless-proxy:1080",
          HTTPS_PROXY: "socks5://vless-proxy:1080",
          ALL_PROXY: "socks5://vless-proxy:1080",
          NO_PROXY: "localhost,127.0.0.1,backend,bot,miniapp,opencode,cliproxy,proxy,vless-proxy"
        }
      })
    };

    const controller = new ProxySettingsController(service as never, { publish: jest.fn() } as never);
    const result = await controller.saveSettings(
      {
        mode: "vless",
        vlessProxyUrl: "socks5://vless-proxy:1080",
        vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality#demo",
        enabledServices: ["bot", "cliproxy"]
      },
      { authAdminId: 649624756 } as unknown as Request
    );

    expect(service.updateSettings).toHaveBeenCalledWith({
      mode: "vless",
      vlessProxyUrl: "socks5://vless-proxy:1080",
      vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality#demo",
      enabledServices: ["bot", "cliproxy"]
    });
    expect(result.mode).toBe("vless");
  });

  test("tests vless config url through controller", async () => {
    /* Test action should stay separate from save so operators can validate before persisting. */
    const service = {
      getSettings: jest.fn(),
      applyRuntimeStack: jest.fn(),
      updateSettings: jest.fn(),
      testVlessConfigUrl: jest.fn().mockResolvedValue({
        ok: true,
        vlessProxyUrl: "http://vless-proxy:8080",
        summary: "example.com:443 via reality"
      })
    };

    const controller = new ProxySettingsController(service as never, { publish: jest.fn() } as never);
    const result = await controller.testSettings(
      { vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality#demo" },
      { authAdminId: 649624756 } as unknown as Request
    );

    expect(service.testVlessConfigUrl).toHaveBeenCalledWith({
      vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality#demo"
    });
    expect(result.ok).toBe(true);
  });

  test("applies runtime compose command", async () => {
    /* Controller should expose explicit endpoint for applying generated proxy runtime files. */
    const service = {
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
      applyRuntimeStack: jest.fn().mockResolvedValue({
        ok: true,
        command: "docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml up -d",
        stdout: "started",
        stderr: ""
      })
    };

    const controller = new ProxySettingsController(service as never, { publish: jest.fn() } as never);
    const result = await controller.applySettings({ authAdminId: 649624756 } as unknown as Request);

    expect(service.applyRuntimeStack).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  test("returns structured validation error for unsupported mode", async () => {
    /* Proxy settings should reject unsupported runtime mode with stable API metadata. */
    const service = {
      getSettings: jest.fn(),
      applyRuntimeStack: jest.fn(),
      updateSettings: jest.fn()
    };

    const controller = new ProxySettingsController(service as never, { publish: jest.fn() } as never);

    await expect(
      controller.saveSettings(
        { mode: "broken" as any, enabledServices: ["bot"] },
        { authAdminId: 649624756 } as unknown as Request
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    try {
      await controller.saveSettings(
        { mode: "broken" as any, enabledServices: ["bot"] },
        { authAdminId: 649624756 } as unknown as Request
      );
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "APP_PROXY_MODE_INVALID",
        message: "Proxy mode must be either 'direct' or 'vless'.",
        hint: "Choose one supported proxy mode and retry saving proxy settings."
      });
    }
  });
});
