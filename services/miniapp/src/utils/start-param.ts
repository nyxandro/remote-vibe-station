/**
 * @fileoverview Start parameter extraction for Telegram Mini App deep-links.
 *
 * Exports:
 * - DIFF_START_PARAM_PREFIX (L10) - Prefix for diff preview launch tokens.
 * - readStartParam (L12) - Reads launch parameter from Telegram/URL context.
 * - readDiffPreviewToken (L43) - Extracts diff preview token when present.
 */

export const DIFF_START_PARAM_PREFIX = "diff_";

export const readStartParam = (): string | null => {
  /* Server-side/non-browser contexts do not provide window object. */
  if (typeof window === "undefined") {
    return null;
  }

  /* Prefer Telegram native start_param from Mini App context. */
  const telegramStartParam = (window as any)?.Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (typeof telegramStartParam === "string" && telegramStartParam.trim().length > 0) {
    return telegramStartParam.trim();
  }

  /* Fallback to URL query parameter used by Telegram web launch. */
  const query = new URLSearchParams(window.location.search);
  const fromQuery = query.get("tgWebAppStartParam");
  if (typeof fromQuery === "string" && fromQuery.trim().length > 0) {
    return fromQuery.trim();
  }

  /* Browser fallback for local debugging. */
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  const fromHash = hashParams.get("startapp");
  if (typeof fromHash === "string" && fromHash.trim().length > 0) {
    return fromHash.trim();
  }

  const legacyDiffToken = hashParams.get("diff");
  if (typeof legacyDiffToken === "string" && legacyDiffToken.trim().length > 0) {
    return `${DIFF_START_PARAM_PREFIX}${legacyDiffToken.trim()}`;
  }

  return null;
};

export const readDiffPreviewToken = (): string | null => {
  /* Decode only tokens that match dedicated diff preview prefix. */
  const startParam = readStartParam();
  if (!startParam || !startParam.startsWith(DIFF_START_PARAM_PREFIX)) {
    return null;
  }

  const token = startParam.slice(DIFF_START_PARAM_PREFIX.length);
  return token.length > 0 ? token : null;
};
