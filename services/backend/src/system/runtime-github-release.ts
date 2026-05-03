/**
 * @fileoverview GitHub release API helpers for runtime self-updates.
 *
 * Exports:
 * - LatestRuntimeVersion - Normalized GitHub release metadata used by runtime updates.
 * - RuntimeGithubTokenProvider - Minimal token source contract for authenticated GitHub API calls.
 * - fetchLatestRuntimeVersion - Loads the latest GitHub release and optional master commit metadata.
 */

const GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/nyxandro/remote-vibe-station/releases/latest";
const GITHUB_MASTER_REF_URL = "https://api.github.com/repos/nyxandro/remote-vibe-station/commits/master";
const GITHUB_FORBIDDEN_STATUS = 403;

export type LatestRuntimeVersion = {
  version?: string;
  imageTag?: string;
  commitSha?: string | null;
  releaseNotes?: string | null;
};

export type RuntimeGithubTokenProvider = {
  getStoredToken: () => string | null;
};

export async function fetchLatestRuntimeVersion(githubApp?: RuntimeGithubTokenProvider): Promise<LatestRuntimeVersion> {
  /* Releases are the source of truth for runtime image tags; auth avoids anonymous shared-IP limits. */
  const headers = buildGithubHeaders(githubApp);
  const response = await fetch(GITHUB_LATEST_RELEASE_URL, { headers });
  if (!response.ok) {
    throwReleaseCheckError(response.status, Boolean(headers.Authorization));
  }

  /* GitHub release tag maps directly to GHCR image tags, while commit metadata is diagnostic-only. */
  const payload = (await response.json()) as { tag_name?: string; target_commitish?: string; body?: string | null };
  const imageTag = typeof payload.tag_name === "string" ? payload.tag_name.trim() : "";
  const version = imageTag.replace(/^v/, "");
  const commitSha = typeof payload.target_commitish === "string" && payload.target_commitish.trim().length > 0
    ? payload.target_commitish.trim()
    : await fetchMasterCommitSha(headers);
  return { version, imageTag, commitSha, releaseNotes: payload.body ?? null };
}

function buildGithubHeaders(githubApp?: RuntimeGithubTokenProvider): Record<string, string> {
  /* Saved global GitHub PAT keeps runtime release checks stable under API rate limits. */
  const token = githubApp?.getStoredToken()?.trim();
  return token
    ? {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`
      }
    : { Accept: "application/vnd.github+json" };
}

async function fetchMasterCommitSha(headers: Record<string, string>): Promise<string | null> {
  /* Commit SHA is useful for diagnostics but must not block release-based updates. */
  const response = await fetch(GITHUB_MASTER_REF_URL, { headers });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as { sha?: string };
  return typeof payload.sha === "string" && payload.sha.trim().length > 0 ? payload.sha.trim() : null;
}

function throwReleaseCheckError(status: number, authenticated: boolean): never {
  /* Anonymous 403 is usually a rate limit; tell operators the exact remediation instead of generic retry text. */
  if (status === GITHUB_FORBIDDEN_STATUS && !authenticated) {
    throw new Error("APP_RUNTIME_GITHUB_TOKEN_REQUIRED: GitHub latest release request failed with HTTP 403 because no GitHub token is saved. Open Settings, connect a GitHub PAT, then retry update check.");
  }

  throw new Error(`APP_RUNTIME_RELEASE_CHECK_FAILED: GitHub latest release request failed with HTTP ${status}. Retry later. Check GitHub access from the server and retry update check.`);
}
