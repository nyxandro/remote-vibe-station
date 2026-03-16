/**
 * @fileoverview Live quota loaders for CLIProxy account cards.
 *
 * Exports:
 * - CliproxyLiveQuotaLoader - Dependency-injectable loader signature used by the account service.
 * - loadCliproxyLiveQuota - Resolves provider-specific live quota payloads for a single auth file.
 */

import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

import {
  buildClaudeAccountQuota,
  buildCodexAccountQuota,
  CLAUDE_PROFILE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_URL,
  CliproxyAccountQuota,
  CODEX_REQUEST_HEADERS,
  CODEX_USAGE_URL,
  resolveCodexChatgptAccountId
} from "./cliproxy-account-quota";
import { CliproxyAuthFile, CliproxyManagementClient, CliproxyProviderId } from "./cliproxy-management.client";

type DownloadedAuthFile = Record<string, unknown>;

type CodexUsageFetcher = (input: {
  accessToken: string;
  accountId: string;
}) => Promise<unknown>;

type LoaderDependencies = {
  api: Pick<
    CliproxyManagementClient,
    "apiCall" | "downloadAuthFileJson"
  >;
  fetchCodexUsage?: CodexUsageFetcher;
};

export type CliproxyLiveQuotaLoader = (
  entry: CliproxyAuthFile | null,
  provider: CliproxyProviderId,
  dependencies: LoaderDependencies
) => Promise<CliproxyAccountQuota | null>;

const proxyDispatcher = new EnvHttpProxyAgent();

const normalizeString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  return null;
};

const parseJsonBody = (value: string): unknown => {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return value;
  }
};

const hasProxyConfiguration = (): boolean => {
  /* CLIProxy api-call ignores our VLESS env vars, so Codex quota fetch must use the backend proxy-aware client. */
  return [process.env.HTTP_PROXY, process.env.HTTPS_PROXY, process.env.ALL_PROXY].some(
    (value) => typeof value === "string" && value.trim().length > 0
  );
};

const fetchCodexUsageViaBackendProxy: CodexUsageFetcher = async (input) => {
  /* Codex quota endpoint is Cloudflare-protected, so send it through the backend's VLESS proxy dispatcher. */
  const response = await undiciFetch(CODEX_USAGE_URL, {
    method: "GET",
    headers: {
      ...CODEX_REQUEST_HEADERS,
      Authorization: `Bearer ${input.accessToken}`,
      "Chatgpt-Account-Id": input.accountId
    },
    dispatcher: hasProxyConfiguration() ? proxyDispatcher : undefined
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `CLIPROXY_CODEX_QUOTA_FETCH_FAILED: Codex quota request returned ${response.status}. ${bodyText || "Empty response."}`
    );
  }

  return parseJsonBody(bodyText);
};

const resolveCodexAccessToken = (downloadedAuthFile: DownloadedAuthFile | null): string | null => {
  /* Codex quota fetch needs the OAuth access token from the downloaded auth file, not just list metadata. */
  return normalizeString(downloadedAuthFile?.access_token ?? downloadedAuthFile?.accessToken);
};

const loadCodexQuota = async (
  entry: CliproxyAuthFile,
  dependencies: LoaderDependencies
): Promise<CliproxyAccountQuota | null> => {
  /* Download auth JSON once because it contains both access token and account metadata. */
  const downloaded = await dependencies.api.downloadAuthFileJson(entry.name).catch(() => null);
  const accountId = resolveCodexChatgptAccountId(entry, downloaded);
  const accessToken = resolveCodexAccessToken(downloaded);

  if (!accountId || !accessToken) {
    return null;
  }

  const payload = await (dependencies.fetchCodexUsage ?? fetchCodexUsageViaBackendProxy)({
    accessToken,
    accountId
  });

  return buildCodexAccountQuota(payload);
};

const loadClaudeQuota = async (
  entry: CliproxyAuthFile,
  dependencies: LoaderDependencies
): Promise<CliproxyAccountQuota | null> => {
  /* Claude quota still works through management api-call, so keep the existing integration there. */
  const [usageResult, profileResult] = await Promise.all([
    dependencies.api.apiCall({
      authIndex: entry.authIndex,
      method: "GET",
      url: CLAUDE_USAGE_URL,
      headers: { ...CLAUDE_REQUEST_HEADERS }
    }),
    dependencies.api.apiCall({
      authIndex: entry.authIndex,
      method: "GET",
      url: CLAUDE_PROFILE_URL,
      headers: { ...CLAUDE_REQUEST_HEADERS }
    }).catch(() => null)
  ]);

  if (usageResult.statusCode < 200 || usageResult.statusCode >= 300) {
    return null;
  }

  return buildClaudeAccountQuota(
    usageResult.body,
    profileResult && profileResult.statusCode >= 200 && profileResult.statusCode < 300 ? profileResult.body : null
  );
};

export const loadCliproxyLiveQuota: CliproxyLiveQuotaLoader = async (entry, provider, dependencies) => {
  /* Unsupported providers should degrade cleanly so the account screen still renders the availability fallback. */
  if (!entry?.authIndex) {
    return null;
  }

  if (provider === "codex") {
    return loadCodexQuota(entry, dependencies);
  }

  if (provider === "anthropic") {
    return loadClaudeQuota(entry, dependencies);
  }

  return null;
};
