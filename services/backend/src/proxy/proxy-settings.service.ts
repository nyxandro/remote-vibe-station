/**
 * @fileoverview Domain service for validating and exposing CLI/Proxy settings.
 *
 * Exports:
 * - ProxySettingsService - Validates updates and builds env preview payload.
 */

import { BadRequestException, Injectable } from "@nestjs/common";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { ProxySettingsStore } from "./proxy-settings.store";
import { DockerComposeService } from "../projects/docker-compose.service";
import {
  ProxyApplyResult,
  ProxyEnabledService,
  ProxySettingsInput,
  ProxySettingsSnapshot,
  ProxySettingsTestInput,
  ProxySettingsTestResult
} from "./proxy-settings.types";
import { parseVlessConfigUrl, renderDisabledXrayConfig, renderXrayConfig } from "./proxy-vless-config";

const URL_PROTOCOL_SEPARATOR = "://";
const RUNTIME_CONFIG_DIR_ENV = "RUNTIME_CONFIG_DIR";
const VLESS_OVERRIDE_FILE = "docker-compose.vless.yml";
const PRIMARY_COMPOSE_FILE = "docker-compose.yml";
const ENV_FILE = ".env";
const VLESS_PROXY_ENV_FILE = path.join("infra", "vless", "proxy.env");
const VLESS_XRAY_CONFIG_FILE = path.join("infra", "vless", "xray.json");
const LOCAL_VLESS_PROXY_URL = "http://vless-proxy:8080";
const DEFAULT_VLESS_ENABLED_SERVICES: ProxyEnabledService[] = ["bot", "cliproxy", "opencode"];
const DEFAULT_NO_PROXY_HOSTS = ["localhost", "127.0.0.1", "backend", "bot", "miniapp", "opencode", "cliproxy", "proxy", "vless-proxy"] as const;

const DIRECT_OVERRIDE_CONTENT = `services: {}\n`;
const SERVICE_COMMENTS: Record<ProxyEnabledService, string> = {
  bot: "Route bot Telegram and provider traffic through VLESS.",
  opencode: "Route OpenCode runtime provider traffic through VLESS.",
  cliproxy: "Route CLIProxy external provider traffic through VLESS."
};

@Injectable()
export class ProxySettingsService {
  public constructor(
    private readonly store: ProxySettingsStore,
    private readonly dockerCompose: DockerComposeService
  ) {}

  public async getSettings(): Promise<ProxySettingsSnapshot> {
    /* Expose current profile together with env values expected by runtime services. */
    const record = await this.store.get();
    await this.syncRuntimeFiles(record);
    return {
      ...record,
      envPreview: this.toEnvPreview(record.mode, record.vlessProxyUrl, record.noProxy),
      runtimeFiles: this.getRuntimeFilesMeta()
    };
  }

  public async updateSettings(input: ProxySettingsInput): Promise<ProxySettingsSnapshot> {
    /* Enforce explicit invariants so Mini App cannot persist ambiguous proxy state. */
    const normalized = this.normalizeInput(input);
    this.assertInput(normalized);

    const saved = await this.store.set(normalized);
    await this.syncRuntimeFiles(saved);
    return {
      ...saved,
      envPreview: this.toEnvPreview(saved.mode, saved.vlessProxyUrl, saved.noProxy),
      runtimeFiles: this.getRuntimeFilesMeta()
    };
  }

  public async testVlessConfigUrl(input: ProxySettingsTestInput): Promise<ProxySettingsTestResult> {
    /* Validate the pasted VLESS URL before the operator can persist and apply runtime changes. */
    const normalizedConfigUrl = input.vlessConfigUrl.trim();
    const parsed = parseVlessConfigUrl(normalizedConfigUrl);
    return {
      ok: true,
      vlessProxyUrl: LOCAL_VLESS_PROXY_URL,
      summary: `${parsed.hostname}:${parsed.port} via ${parsed.type}/${parsed.security}`
    };
  }

  public async applyRuntimeStack(): Promise<ProxyApplyResult> {
    /* Only recycle proxy-target services so Apply action does not take down Mini App ingress or unrelated control-plane services. */
    const runtimeConfigDir = this.requireRuntimeConfigDir();
    const record = await this.store.get();
    const targetServices = this.buildApplyTargetServices(record);
    const args = [
      "--env-file",
      ENV_FILE,
      "-f",
      PRIMARY_COMPOSE_FILE,
      "-f",
      VLESS_OVERRIDE_FILE,
      "up",
      "-d",
      "--remove-orphans",
      ...targetServices
    ];
    const result = await this.dockerCompose.run(args, runtimeConfigDir);
    return {
      ok: true,
      command: this.toApplyCommand(),
      stdout: result.stdout,
      stderr: result.stderr
    };
  }

  private async syncRuntimeFiles(record: ProxySettingsInput): Promise<void> {
    /* Persist generated runtime override/env files when backend has runtime config mount. */
    const runtimeConfigDir = process.env[RUNTIME_CONFIG_DIR_ENV]?.trim() || "";
    if (!runtimeConfigDir) {
      return;
    }

    const noProxy = this.buildNoProxy(record.enabledServices);

    const overridePath = path.join(runtimeConfigDir, VLESS_OVERRIDE_FILE);
    const proxyEnvPath = path.join(runtimeConfigDir, VLESS_PROXY_ENV_FILE);
    const xrayConfigPath = path.join(runtimeConfigDir, VLESS_XRAY_CONFIG_FILE);

    await fs.mkdir(path.dirname(proxyEnvPath), { recursive: true });
    await fs.writeFile(proxyEnvPath, this.renderProxyEnv(record.mode, record.vlessProxyUrl, noProxy), "utf-8");

    const overrideContent = record.mode === "vless" ? this.renderVlessOverride(record.enabledServices) : DIRECT_OVERRIDE_CONTENT;
    await fs.writeFile(overridePath, overrideContent, "utf-8");

    const xrayContent =
      record.mode === "vless" && record.vlessConfigUrl
        ? renderXrayConfig(parseVlessConfigUrl(record.vlessConfigUrl))
        : renderDisabledXrayConfig();
    await fs.mkdir(path.dirname(xrayConfigPath), { recursive: true });
    await fs.writeFile(xrayConfigPath, xrayContent, "utf-8");
  }

  private renderProxyEnv(mode: "direct" | "vless", vlessProxyUrl: string | null, noProxy: string): string {
    /* Generate deterministic env file consumed by bot/cliproxy override env_file. */
    const proxyValue = mode === "vless" ? vlessProxyUrl ?? "" : "";
    return [
      "# Generated by Remote Vibe Station Mini App (CLI/Proxy tab)",
      `HTTP_PROXY=${proxyValue}`,
      `HTTPS_PROXY=${proxyValue}`,
      `ALL_PROXY=${proxyValue}`,
      `NO_PROXY=${noProxy}`,
      ""
    ].join("\n");
  }

  private getRuntimeFilesMeta() {
    /* Expose generated file paths and apply command to simplify operator workflow. */
    const runtimeConfigDir = process.env[RUNTIME_CONFIG_DIR_ENV]?.trim() || null;
    if (!runtimeConfigDir) {
      return {
        runtimeConfigDir: null,
        proxyEnvPath: null,
        overridePath: null,
        xrayConfigPath: null,
        recommendedApplyCommand: null
      };
    }

    const proxyEnvPath = path.join(runtimeConfigDir, VLESS_PROXY_ENV_FILE);
    const overridePath = path.join(runtimeConfigDir, VLESS_OVERRIDE_FILE);
    const xrayConfigPath = path.join(runtimeConfigDir, VLESS_XRAY_CONFIG_FILE);
    return {
      runtimeConfigDir,
      proxyEnvPath,
      overridePath,
      xrayConfigPath,
      recommendedApplyCommand: this.toApplyCommand()
    };
  }

  private toApplyCommand(): string {
    /* Keep one canonical compose command shape for API/UI to avoid mismatch. */
    return `docker compose --env-file ${ENV_FILE} -f ${PRIMARY_COMPOSE_FILE} -f ${VLESS_OVERRIDE_FILE} up -d --remove-orphans <proxy-services>`;
  }

  private requireRuntimeConfigDir(): string {
    /* Applying runtime stack requires mounted runtime config directory. */
    const runtimeConfigDir = process.env[RUNTIME_CONFIG_DIR_ENV]?.trim() || "";
    if (!runtimeConfigDir) {
      throw new BadRequestException("RUNTIME_CONFIG_DIR is not configured in backend container");
    }
    return runtimeConfigDir;
  }

  private normalizeInput(input: ProxySettingsInput): ProxySettingsInput {
    /* Trim incoming strings to keep persisted profile canonical and diff-friendly. */
    return {
      mode: input.mode,
      vlessProxyUrl:
        typeof input.vlessProxyUrl === "string" && input.vlessProxyUrl.trim().length > 0
          ? input.vlessProxyUrl.trim()
          : null,
      vlessConfigUrl:
        typeof input.vlessConfigUrl === "string" && input.vlessConfigUrl.trim().length > 0
          ? input.vlessConfigUrl.trim()
          : null,
      enabledServices:
        input.mode === "vless"
          ? ([...new Set(input.enabledServices)].sort() as ProxyEnabledService[])
          : [...DEFAULT_VLESS_ENABLED_SERVICES],
    };
  }

  private assertInput(input: ProxySettingsInput): void {
    /* VLESS mode requires explicit proxy URL, direct mode forbids stale URL values. */
    if (input.mode === "vless") {
      if (!input.vlessProxyUrl) {
        throw new BadRequestException("vlessProxyUrl is required for vless mode");
      }

      if (!input.vlessConfigUrl) {
        throw new BadRequestException("vlessConfigUrl is required for vless mode");
      }

      if (!this.isProxyUrl(input.vlessProxyUrl)) {
        throw new BadRequestException("vlessProxyUrl must include protocol (socks5/http/https)");
      }

      parseVlessConfigUrl(input.vlessConfigUrl);

      if (input.enabledServices.length === 0) {
        throw new BadRequestException("enabledServices must include at least one service");
      }
    }

    if (input.mode === "direct" && (input.vlessProxyUrl || input.vlessConfigUrl)) {
      throw new BadRequestException("vlessProxyUrl and vlessConfigUrl must be empty in direct mode");
    }

  }

  private buildNoProxy(enabledServices: ProxyEnabledService[]): string {
    /* Runtime proxy exclusions must always include local/container hostnames, even when UI only selects target services. */
    const hostnames = new Set<string>(DEFAULT_NO_PROXY_HOSTS);

    for (const serviceId of enabledServices) {
      hostnames.add(serviceId);
    }

    return [...hostnames].sort().join(",");
  }

  private buildApplyTargetServices(record: ProxySettingsInput): string[] {
    /* VLESS apply should touch only services whose runtime env changes, plus the proxy sidecar in VLESS mode. */
    const targets = record.mode === "vless" ? ["vless-proxy", ...record.enabledServices] : [...DEFAULT_VLESS_ENABLED_SERVICES];
    return [...new Set(targets)];
  }

  private isProxyUrl(value: string): boolean {
    /* Keep validation strict enough for runtime env export but still protocol-agnostic. */
    if (!value.includes(URL_PROTOCOL_SEPARATOR)) {
      return false;
    }

    return /^socks5h?:\/\//i.test(value) || /^https?:\/\//i.test(value);
  }

  private toEnvPreview(mode: "direct" | "vless", vlessProxyUrl: string | null, noProxy: string) {
    /* Build env snapshot consumed by bot/cliproxy when proxy mode is enabled. */
    if (mode === "direct") {
      return {
        HTTP_PROXY: null,
        HTTPS_PROXY: null,
        ALL_PROXY: null,
        NO_PROXY: noProxy
      };
    }

    return {
      HTTP_PROXY: vlessProxyUrl,
      HTTPS_PROXY: vlessProxyUrl,
      ALL_PROXY: vlessProxyUrl,
      NO_PROXY: noProxy
    };
  }

  private renderVlessOverride(enabledServices: ProxyEnabledService[]): string {
    /* Compose override should wire only the services explicitly selected in Mini App. */
    const serviceBlocks = enabledServices
      .map((serviceId) => {
        return [
          `  ${serviceId}:`,
          `    # ${SERVICE_COMMENTS[serviceId]}`,
          "    env_file:",
          "      - ./infra/vless/proxy.env",
          "    depends_on:",
          "      - vless-proxy",
          "    networks:",
          "      - ai_proxy"
        ].join("\n");
      })
      .join("\n\n");

    return [
      "x-logging-defaults: &logging_defaults",
      "  driver: json-file",
      "  options:",
      '    max-size: "10m"',
      '    max-file: "5"',
      "",
      "services:",
      "  vless-proxy:",
      '    image: ghcr.io/xtls/xray-core:latest',
      '    command: ["sh", "-lc", "cat /runtime-config/infra/vless/xray.json > /tmp/xray.json && exec /usr/local/bin/xray run -c /tmp/xray.json"]',
      "    volumes:",
      '      - ./:/runtime-config:ro',
       '    networks:',
       '      - ai_proxy',
      '    logging: *logging_defaults',
      '    restart: unless-stopped',
      serviceBlocks ? `\n${serviceBlocks}` : "",
      "",
      "networks:",
      "  ai_proxy:",
      "    driver: bridge",
      ""
    ].join("\n");
  }

}
