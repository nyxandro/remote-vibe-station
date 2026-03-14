/**
 * @fileoverview Shared helpers for standalone kanban board URL generation.
 *
 * Exports:
 * - resolveKanbanBoardBaseUrl - Chooses local dev origin or configured public base URL.
 * - buildKanbanBoardUrl - Builds signed standalone kanban board link with optional project filter.
 */

import { KanbanValidationError } from "./kanban.errors";
import { requireKanbanProjectSlug } from "./kanban-value-guards";

export const resolveKanbanBoardBaseUrl = (input: {
  publicBaseUrl: string;
  localDevOrigin?: string | null;
}): string => {
  /* Local browser debugging should open localhost directly, while production keeps using the canonical public base URL. */
  const candidate = String(input.localDevOrigin ?? "").trim() || String(input.publicBaseUrl ?? "").trim();

  try {
    return new URL(candidate).toString();
  } catch {
    throw new KanbanValidationError(
      "APP_KANBAN_BOARD_BASE_URL_INVALID: Cannot create shared board link because board base URL is invalid. Fix PUBLIC_BASE_URL or reopen Mini App through a valid localhost URL."
    );
  }
};

export const buildKanbanBoardUrl = (input: {
  token: string;
  publicBaseUrl: string;
  localDevOrigin?: string | null;
  projectSlug?: string | null;
}): string => {
  /* Canonical trailing slash avoids redirect chains that would otherwise drop query params in some nginx/Traefik paths. */
  const baseUrl = resolveKanbanBoardBaseUrl({
    publicBaseUrl: input.publicBaseUrl,
    localDevOrigin: input.localDevOrigin
  });
  const url = new URL("/miniapp/", baseUrl);
  url.searchParams.set("view", "kanban");

  /* Optional project filter stays explicit so local/global board links share the same route contract. */
  if (input.projectSlug) {
    url.searchParams.set("project", requireKanbanProjectSlug(input.projectSlug));
  }

  /* Keep token in the fragment so browser auth stays client-side, but encode it defensively for future token format changes. */
  url.hash = `token=${encodeURIComponent(input.token)}`;
  return url.toString();
};
