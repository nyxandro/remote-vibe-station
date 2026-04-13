/**
 * @fileoverview Tests for broad VLESS URL parsing and xray config generation.
 *
 * Test suites:
 * - ProxySettingsService VLESS parsing - Verifies tcp/reality, ws/tls, grpc/tls, and tcp/tls links render into xray config.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { ProxySettingsService } from "../proxy-settings.service";

describe("ProxySettingsService VLESS parsing", () => {
  const buildStore = (vlessConfigUrl: string) => ({
    get: jest.fn().mockResolvedValue({
      mode: "direct",
      vlessProxyUrl: null,
      vlessConfigUrl: null,
      enabledServices: ["backend", "bot", "miniapp", "opencode", "cliproxy"],
      noProxy: "localhost,127.0.0.1,backend",
      updatedAt: "2026-03-06T00:00:00.000Z"
    }),
    set: jest.fn().mockResolvedValue({
      mode: "vless",
      vlessProxyUrl: "http://vless-proxy:8080",
      vlessConfigUrl,
      enabledServices: ["backend", "bot"],
      noProxy: "localhost,127.0.0.1,backend",
      updatedAt: "2026-03-06T00:01:00.000Z"
    })
  });

  const readGeneratedXray = async (runtimeDir: string): Promise<string> => {
    return fs.readFile(path.join(runtimeDir, "infra", "vless", "xray.json"), "utf-8");
  };

  test("renders websocket tls config with host and path", async () => {
    /* CDN-style links often use ws+tls and must preserve host/path headers in xray config. */
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-vless-ws-"));
    const prevRuntimeDir = process.env.RUNTIME_CONFIG_DIR;
    process.env.RUNTIME_CONFIG_DIR = runtimeDir;

    try {
      const vlessConfigUrl =
        "vless://uuid@example.com:443?type=ws&security=tls&sni=cdn.example.com&host=app.example.com&path=%2Fsocket%3Fed%3D2048&alpn=h2%2Chttp%2F1.1#ws";
      const service = new ProxySettingsService(buildStore(vlessConfigUrl) as never, { run: jest.fn() } as never);

      await service.updateSettings({
        mode: "vless",
        vlessProxyUrl: "http://vless-proxy:8080",
        vlessConfigUrl,
        enabledServices: ["bot", "cliproxy"]
      });

      const xray = await readGeneratedXray(runtimeDir);
      expect(xray).toContain('"network": "ws"');
      expect(xray).toContain('"security": "tls"');
      expect(xray).toContain('"serverName": "cdn.example.com"');
      expect(xray).toContain('"Host": "app.example.com"');
      expect(xray).toContain('"path": "/socket?ed=2048"');
    } finally {
      if (prevRuntimeDir === undefined) {
        delete process.env.RUNTIME_CONFIG_DIR;
      } else {
        process.env.RUNTIME_CONFIG_DIR = prevRuntimeDir;
      }
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });

  test("renders grpc tls config with service name and authority", async () => {
    /* gRPC links must keep serviceName/authority so providers behind grpc gateways still connect. */
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-vless-grpc-"));
    const prevRuntimeDir = process.env.RUNTIME_CONFIG_DIR;
    process.env.RUNTIME_CONFIG_DIR = runtimeDir;

    try {
      const vlessConfigUrl =
        "vless://uuid@example.com:443?type=grpc&security=tls&sni=grpc.example.com&serviceName=gun&authority=edge.example.com&alpn=h2#grpc";
      const service = new ProxySettingsService(buildStore(vlessConfigUrl) as never, { run: jest.fn() } as never);

      await service.updateSettings({
        mode: "vless",
        vlessProxyUrl: "http://vless-proxy:8080",
        vlessConfigUrl,
        enabledServices: ["bot", "cliproxy"]
      });

      const xray = await readGeneratedXray(runtimeDir);
      expect(xray).toContain('"network": "grpc"');
      expect(xray).toContain('"serviceName": "gun"');
      expect(xray).toContain('"authority": "edge.example.com"');
      expect(xray).toContain('"serverName": "grpc.example.com"');
    } finally {
      if (prevRuntimeDir === undefined) {
        delete process.env.RUNTIME_CONFIG_DIR;
      } else {
        process.env.RUNTIME_CONFIG_DIR = prevRuntimeDir;
      }
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });

  test("accepts plain tcp tls links with flow and alpn", async () => {
    /* Plain tls links should still preserve flow/alpn fields for vision-style profiles. */
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-vless-tcp-tls-"));
    const prevRuntimeDir = process.env.RUNTIME_CONFIG_DIR;
    process.env.RUNTIME_CONFIG_DIR = runtimeDir;

    try {
      const vlessConfigUrl =
        "vless://uuid@example.com:8443?type=tcp&security=tls&sni=tls.example.com&flow=xtls-rprx-vision&alpn=h2%2Chttp%2F1.1#tcp-tls";
      const service = new ProxySettingsService(buildStore(vlessConfigUrl) as never, { run: jest.fn() } as never);

      const result = await service.testVlessConfigUrl({ vlessConfigUrl });
      expect(result.ok).toBe(true);

      await service.updateSettings({
        mode: "vless",
        vlessProxyUrl: "http://vless-proxy:8080",
        vlessConfigUrl,
        enabledServices: ["bot", "cliproxy"]
      });

      const xray = await readGeneratedXray(runtimeDir);
      expect(xray).toContain('"network": "tcp"');
      expect(xray).toContain('"security": "tls"');
      expect(xray).toContain('"flow": "xtls-rprx-vision"');
      expect(xray).toContain('"serverName": "tls.example.com"');
    } finally {
      if (prevRuntimeDir === undefined) {
        delete process.env.RUNTIME_CONFIG_DIR;
      } else {
        process.env.RUNTIME_CONFIG_DIR = prevRuntimeDir;
      }
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });
});
