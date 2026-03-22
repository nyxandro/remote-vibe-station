/**
 * @fileoverview Helpers for Mini App workspace live invalidation events.
 *
 * Exports:
 * - WorkspaceEventSurface - Mini App surfaces that can be invalidated live.
 * - WorkspaceStateChangedEventData - Payload for workspace state-change websocket events.
 * - publishWorkspaceStateChangedEvent - Publishes one normalized workspace invalidation event.
 */

import { EventsService } from "./events.service";

const WORKSPACE_EVENT_SURFACES = ["projects", "git", "files", "settings", "providers"] as const;

export type WorkspaceEventSurface = (typeof WORKSPACE_EVENT_SURFACES)[number];

export type WorkspaceStateChangedEventData = {
  adminId: number | null;
  projectSlug: string | null;
  surfaces: WorkspaceEventSurface[];
  reason: string;
};

export const publishWorkspaceStateChangedEvent = (input: {
  events: Pick<EventsService, "publish">;
  adminId?: number | null;
  projectSlug?: string | null;
  surfaces: readonly WorkspaceEventSurface[];
  reason: string;
}): void => {
  /* Deduplicate/normalize surfaces so frontend invalidation can stay deterministic across publishers. */
  const adminId = typeof input.adminId === "number" && Number.isFinite(input.adminId) ? input.adminId : null;
  const surfaces = normalizeSurfaces(input.surfaces);
  if (surfaces.length === 0) {
    return;
  }

  input.events.publish({
    type: "workspace.state.changed",
    ts: new Date().toISOString(),
    data: {
      adminId,
      projectSlug: normalizeProjectSlug(input.projectSlug),
      surfaces,
      reason: input.reason.trim()
    } satisfies WorkspaceStateChangedEventData
  });
};

const normalizeSurfaces = (surfaces: readonly WorkspaceEventSurface[]): WorkspaceEventSurface[] => {
  /* Invalid surfaces should be dropped silently so one bad publisher cannot break the event stream. */
  const unique = new Set<WorkspaceEventSurface>();
  surfaces.forEach((surface) => {
    if ((WORKSPACE_EVENT_SURFACES as readonly string[]).includes(surface)) {
      unique.add(surface);
    }
  });
  return Array.from(unique.values()).sort();
};

const normalizeProjectSlug = (projectSlug?: string | null): string | null => {
  /* Optional project scope lets global settings/providers updates coexist with project-bound git/files invalidation. */
  if (typeof projectSlug !== "string") {
    return null;
  }

  const normalized = projectSlug.trim();
  return normalized.length > 0 ? normalized : null;
};
