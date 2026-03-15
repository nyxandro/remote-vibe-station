/**
 * @fileoverview Proxy-aware fetch helper for selective backend outbound HTTP calls.
 *
 * Exports:
 * - fetchWithOptionalProxy - Executes fetch with undici ProxyAgent when HTTP(S)_PROXY applies.
 */

import { ProxyAgent } from "undici";

const proxyAgents = new Map<string, ProxyAgent>();

export const fetchWithOptionalProxy = async (input: string, init?: RequestInit): Promise<Response> => {
  /* External validations should honor runtime proxy env without affecting internal service traffic. */
  const dispatcher = resolveDispatcher(input);
  if (!dispatcher) {
    return fetch(input, init);
  }

  return fetch(input, {
    ...init,
    dispatcher
  } as RequestInit & { dispatcher: ProxyAgent });
};

const resolveDispatcher = (input: string): ProxyAgent | null => {
  /* Proxy selection depends on URL protocol and NO_PROXY hostname exclusions. */
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (isNoProxyHost(url.hostname)) {
    return null;
  }

  const proxyUrl = selectProxyUrl(url.protocol);
  if (!proxyUrl) {
    return null;
  }

  const cached = proxyAgents.get(proxyUrl);
  if (cached) {
    return cached;
  }

  /* Reuse one ProxyAgent per proxy URI so validation calls do not churn sockets. */
  const created = new ProxyAgent({ uri: proxyUrl });
  proxyAgents.set(proxyUrl, created);
  return created;
};

const selectProxyUrl = (protocol: string): string | null => {
  /* HTTPS requests prefer HTTPS_PROXY first; HTTP keeps HTTP_PROXY precedence. */
  if (protocol === "https:") {
    return readProxyEnv("HTTPS_PROXY", "https_proxy") ?? readProxyEnv("HTTP_PROXY", "http_proxy") ?? readProxyEnv("ALL_PROXY", "all_proxy");
  }

  if (protocol === "http:") {
    return readProxyEnv("HTTP_PROXY", "http_proxy") ?? readProxyEnv("HTTPS_PROXY", "https_proxy") ?? readProxyEnv("ALL_PROXY", "all_proxy");
  }

  return readProxyEnv("ALL_PROXY", "all_proxy");
};

const readProxyEnv = (primaryKey: string, secondaryKey: string): string | null => {
  /* Support both uppercase and lowercase proxy env conventions. */
  return normalizeProxyUrl(process.env[primaryKey] ?? process.env[secondaryKey]);
};

const normalizeProxyUrl = (value: string | undefined): string | null => {
  /* Empty env vars must behave like unset values. */
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
};

const isNoProxyHost = (hostname: string): boolean => {
  /* NO_PROXY supports exact hosts, dotted suffixes, and wildcard semantics. */
  const rawValue = process.env.NO_PROXY ?? process.env.no_proxy;
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!raw) {
    return false;
  }

  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") {
        return true;
      }
      if (hostname.toLowerCase() === entry) {
        return true;
      }
      if (entry.startsWith(".")) {
        return hostname.toLowerCase().endsWith(entry);
      }
      return hostname.toLowerCase().endsWith(`.${entry}`);
    });
};
