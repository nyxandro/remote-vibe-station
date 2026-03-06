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
          noProxy: "localhost,127.0.0.1,backend",
          updatedAt: "2026-03-06T00:00:00.000Z"
        }),
        set: jest.fn().mockResolvedValue({
          mode: "vless",
          vlessProxyUrl: "socks5://vless-proxy:1080",
          noProxy: "localhost,127.0.0.1,backend",
          updatedAt: "2026-03-06T00:01:00.000Z"
        })
      };

      const docker = { run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" }) };
      const service = new ProxySettingsService(store as never, docker as never);
      const snapshot = await service.updateSettings({
        mode: "vless",
        vlessProxyUrl: "socks5://vless-proxy:1080",
        noProxy: "localhost,127.0.0.1,backend"
      });

      const proxyEnvPath = path.join(runtimeDir, "infra", "vless", "proxy.env");
      const overridePath = path.join(runtimeDir, "docker-compose.vless.yml");
      const proxyEnvContent = await fs.readFile(proxyEnvPath, "utf-8");
      const overrideContent = await fs.readFile(overridePath, "utf-8");

      expect(proxyEnvContent).toContain("HTTP_PROXY=socks5://vless-proxy:1080");
      expect(proxyEnvContent).toContain("NO_PROXY=localhost,127.0.0.1,backend");
      expect(overrideContent).toContain("vless-proxy");
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
    /* Apply action should run docker compose with explicit override files in runtime dir. */
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-runtime-apply-"));
    const prevRuntimeDir = process.env.RUNTIME_CONFIG_DIR;
    process.env.RUNTIME_CONFIG_DIR = runtimeDir;

    try {
      const store = {
        get: jest.fn().mockResolvedValue({
          mode: "direct",
          vlessProxyUrl: null,
          noProxy: "localhost",
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
        ["--env-file", ".env", "-f", "docker-compose.yml", "-f", "docker-compose.vless.yml", "up", "-d"],
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
});
