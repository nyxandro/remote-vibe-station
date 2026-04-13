/**
 * @fileoverview Tests for proxy settings service runtime-file generation flow.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { ProxySettingsService } from "../proxy-settings.service";

describe("ProxySettingsService", () => {
  test("generates proxy env and override files when runtime dir is configured", async () => {
    /* Saving proxy profile should immediately sync runtime files used by compose override. */
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-runtime-files-"));
    const prevRuntimeDir = process.env.RUNTIME_CONFIG_DIR;
    process.env.RUNTIME_CONFIG_DIR = runtimeDir;

    try {
      const store = {
        get: jest.fn().mockResolvedValue({
          mode: "direct",
          vlessProxyUrl: null,
          vlessConfigUrl: null,
          enabledServices: ["bot", "cliproxy", "opencode"],
          noProxy: "localhost,127.0.0.1,backend,bot,miniapp,opencode,cliproxy,proxy,vless-proxy",
          updatedAt: "2026-03-06T00:00:00.000Z"
        }),
        set: jest.fn().mockResolvedValue({
          mode: "vless",
          vlessProxyUrl: "socks5://vless-proxy:1080",
          vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality&pbk=test-key&sni=example.com&fp=chrome#demo",
          enabledServices: ["bot", "cliproxy", "opencode"],
          noProxy: "localhost,127.0.0.1,backend,bot,miniapp,opencode,cliproxy,proxy,vless-proxy",
          updatedAt: "2026-03-06T00:01:00.000Z"
        })
      };

      const docker = { run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" }) };
      const service = new ProxySettingsService(store as never, docker as never);
      const snapshot = await service.updateSettings({
        mode: "vless",
        vlessProxyUrl: "socks5://vless-proxy:1080",
        vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality&pbk=test-key&sni=example.com&fp=chrome#demo",
        enabledServices: ["bot", "cliproxy", "opencode"]
      });

      const proxyEnvPath = path.join(runtimeDir, "infra", "vless", "proxy.env");
      const overridePath = path.join(runtimeDir, "docker-compose.vless.yml");
      const xrayPath = path.join(runtimeDir, "infra", "vless", "xray.json");
      const proxyEnvContent = await fs.readFile(proxyEnvPath, "utf-8");
      const overrideContent = await fs.readFile(overridePath, "utf-8");
      const xrayContent = await fs.readFile(xrayPath, "utf-8");

      expect(proxyEnvContent).toContain("HTTP_PROXY=socks5://vless-proxy:1080");
      expect(proxyEnvContent).toContain("NO_PROXY=127.0.0.1,backend,bot,cliproxy,localhost,miniapp,opencode,proxy,vless-proxy");
      expect(overrideContent).toContain("vless-proxy");
      expect(overrideContent).toContain("bot:");
      expect(overrideContent).toContain("cliproxy:");
      expect(overrideContent).toContain("opencode:");
      expect(overrideContent).not.toContain("backend:");
      expect(overrideContent).not.toContain("miniapp:");
      expect(xrayContent).toContain('"protocol": "vless"');
      expect(xrayContent).toContain('"serverName": "example.com"');
      expect(snapshot.runtimeFiles.runtimeConfigDir).toBe(runtimeDir);
    } finally {
      if (prevRuntimeDir === undefined) {
        delete process.env.RUNTIME_CONFIG_DIR;
      } else {
        process.env.RUNTIME_CONFIG_DIR = prevRuntimeDir;
      }
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });

  test("applies runtime compose in configured runtime directory", async () => {
    /* Apply action should only restart proxy-capable services so Mini App ingress never drops during a VLESS toggle. */
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-runtime-apply-"));
    const prevRuntimeDir = process.env.RUNTIME_CONFIG_DIR;
    process.env.RUNTIME_CONFIG_DIR = runtimeDir;

    try {
      const store = {
        get: jest.fn().mockResolvedValue({
          mode: "vless",
          vlessProxyUrl: "socks5://vless-proxy:1080",
          vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality#demo",
          enabledServices: ["bot", "cliproxy"],
          noProxy: "localhost,127.0.0.1,backend,bot,miniapp,opencode,cliproxy,proxy,vless-proxy",
          updatedAt: "2026-03-06T00:00:00.000Z"
        }),
        set: jest.fn()
      };
      const docker = {
        run: jest.fn().mockResolvedValue({
          exitCode: 0,
          stdout: "done",
          stderr: ""
        })
      };
      const service = new ProxySettingsService(store as never, docker as never);

      const result = await service.applyRuntimeStack();

      expect(docker.run).toHaveBeenCalledWith(
        [
          "--env-file",
          ".env",
          "-f",
          "docker-compose.yml",
          "-f",
          "docker-compose.vless.yml",
          "up",
          "-d",
          "--remove-orphans",
          "vless-proxy",
          "bot",
          "cliproxy"
        ],
        runtimeDir
      );
      expect(result.ok).toBe(true);
      expect(result.stdout).toBe("done");
    } finally {
      if (prevRuntimeDir === undefined) {
        delete process.env.RUNTIME_CONFIG_DIR;
      } else {
        process.env.RUNTIME_CONFIG_DIR = prevRuntimeDir;
      }
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });

  test("applies direct mode without restarting unrelated ingress services", async () => {
    /* Direct-mode apply should recycle only previously proxy-capable services and remove the VLESS orphan. */
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-runtime-apply-direct-"));
    const prevRuntimeDir = process.env.RUNTIME_CONFIG_DIR;
    process.env.RUNTIME_CONFIG_DIR = runtimeDir;

    try {
      const store = {
        get: jest.fn().mockResolvedValue({
          mode: "direct",
          vlessProxyUrl: null,
          vlessConfigUrl: null,
          enabledServices: ["bot", "cliproxy", "opencode"],
          noProxy: "localhost,127.0.0.1,backend,bot,miniapp,opencode,cliproxy,proxy,vless-proxy",
          updatedAt: "2026-03-06T00:00:00.000Z"
        }),
        set: jest.fn()
      };
      const docker = {
        run: jest.fn().mockResolvedValue({
          exitCode: 0,
          stdout: "done",
          stderr: ""
        })
      };
      const service = new ProxySettingsService(store as never, docker as never);

      await service.applyRuntimeStack();

      expect(docker.run).toHaveBeenCalledWith(
        [
          "--env-file",
          ".env",
          "-f",
          "docker-compose.yml",
          "-f",
          "docker-compose.vless.yml",
          "up",
          "-d",
          "--remove-orphans",
          "bot",
          "cliproxy",
          "opencode"
        ],
        runtimeDir
      );
    } finally {
      if (prevRuntimeDir === undefined) {
        delete process.env.RUNTIME_CONFIG_DIR;
      } else {
        process.env.RUNTIME_CONFIG_DIR = prevRuntimeDir;
      }
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });

  test("tests vless config url and returns derived local proxy url", async () => {
    /* Mini App test action should validate operator input before it can be saved. */
    const store = {
      get: jest.fn().mockResolvedValue({
        mode: "direct",
        vlessProxyUrl: null,
        vlessConfigUrl: null,
          enabledServices: ["bot", "cliproxy", "opencode"],
          noProxy: "localhost,127.0.0.1,backend,bot,miniapp,opencode,cliproxy,proxy,vless-proxy",
        updatedAt: "2026-03-06T00:00:00.000Z"
      }),
      set: jest.fn()
    };
    const docker = { run: jest.fn() };
    const service = new ProxySettingsService(store as never, docker as never);

    const result = await service.testVlessConfigUrl({
      vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality&pbk=test-key&sni=example.com&fp=chrome#demo"
    });

    expect(result.ok).toBe(true);
    expect(result.vlessProxyUrl).toBe("http://vless-proxy:8080");
    expect(result.summary).toContain("example.com:443");
  });
});
