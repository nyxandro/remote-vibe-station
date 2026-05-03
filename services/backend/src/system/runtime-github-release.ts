/**
 * @fileoverview GitHub release API helpers for runtime self-updates.
 *
 * Exports:
 * - LatestRuntimeVersion - Normalized GitHub release metadata used by runtime updates.
 * - RuntimeGithubTokenProvider - Minimal token source contract for authenticated GitHub API calls.
 * - fetchLatestRuntimeVersion - Loads the latest GitHub release and optional master commit metadata.
 */

const GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/nyxandro/remote-vibe-station/releases/latest";
const GITHUB_PUBLIC_LATEST_RELEASE_URL = "https://github.com/nyxandro/remote-vibe-station/releases/latest";
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
  /* The API gives full release metadata; a saved PAT is optional and only improves rate-limit stability. */
  const headers = buildGithubHeaders(githubApp);
  const response = await fetch(GITHUB_LATEST_RELEASE_URL, { headers });
  if (!response.ok) {
    if (response.status === GITHUB_FORBIDDEN_STATUS && !headers.Authorization) {
      return fetchLatestRuntimeVersionFromPublicRedirect();
    }

    throwReleaseCheckError(response.status);
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
  /* Saved global GitHub PAT is optional; public installs must still update without credentials. */
  const token = githubApp?.getStoredToken()?.trim();
  return token
    ? {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`
      }
    : { Accept: "application/vnd.github+json" };
}

async function fetchLatestRuntimeVersionFromPublicRedirect(): Promise<LatestRuntimeVersion> {
  /* The public release page redirect is not API-rate-limited and exposes the latest tag in the final URL. */
  const response = await fetch(GITHUB_PUBLIC_LATEST_RELEASE_URL, { redirect: "manual" });
  if (response.status < 300 || response.status >= 400) {
    throwReleaseCheckError(response.status);
  }

  /* GitHub returns Location: /owner/repo/releases/tag/vX.Y.Z; accept absolute and relative variants. */
  const location = response.headers.get("location")?.trim();
  const imageTag = location?.match(/\/releases\/tag\/([^/?#]+)/)?.[1]?.trim() ?? "";
  if (!imageTag) {
    throw new Error("APP_RUNTIME_RELEASE_REDIRECT_INVALID: GitHub public latest release redirect did not include a release tag. Retry later or open the releases page manually.");
  }

  return { version: imageTag.replace(/^v/, ""), imageTag, commitSha: null, releaseNotes: null };
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

function throwReleaseCheckError(status: number): never {
  /* Keep failures actionable without requiring credentials for public self-hosted installations. */
  throw new Error(`APP_RUNTIME_RELEASE_CHECK_FAILED: GitHub latest release request failed with HTTP ${status}. Retry later. Check GitHub access from the server and retry update check.`);
}
