/**
 * @fileoverview Pure helpers for server-local remote-dev route settings.
 *
 * Exports:
 * - buildProjectDomain - Builds primary or subdomain host for a project.
 * - buildPreviewUrl - Selects the primary preview URL from route snapshots.
 * - normalizeRuntimeRoutes - Normalizes persisted/API route payloads.
 * - assertRuntimeRoutes - Validates explicit route configuration.
 * - buildSettingsFromRoutes - Derives legacy top-level fields from routes.
 * - toEffectiveRoutes - Converts legacy single-route settings into one primary route.
 * - toRouteSnapshots - Enriches routes with preview URLs.
 */

import {
  ProjectRuntimeRoute,
  ProjectRuntimeRoutePatch,
  ProjectRuntimeRouteSnapshot,
  ProjectRuntimeSettings
} from "./project-runtime.types";

const normalizeNullableString = (value: string | null | undefined): string | null => {
  /* Empty strings should not create implicit route values in persisted settings. */
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeNullablePort = (value: number | null | undefined): number | null => {
  /* Route ports must stay explicit and valid for deterministic Traefik label generation. */
  if (typeof value !== "number") {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`Invalid internalPort: ${value}`);
  }
  return value;
};

const requireRouteId = (value: string | null | undefined, index: number): string => {
  /* Route ids become stable config keys and Traefik router fragments. */
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") : "";
  if (!normalized) {
    throw new Error(`Route id is required for route #${index + 1}`);
  }
  return normalized;
};

export const buildProjectDomain = (slug: string, publicDomain: string, subdomain: string | null): string => {
  /* Shared VDS uses <slug>.<public-domain> for primary route and <subdomain>.<slug>.<public-domain> for extras. */
  if (!subdomain) {
    return `${slug}.${publicDomain}`;
  }
  return `${subdomain}.${slug}.${publicDomain}`;
};

export const buildPreviewUrl = (slug: string, publicDomain: string, routes: ProjectRuntimeRouteSnapshot[]): string => {
  /* Prefer the primary route for UI quick-open actions and fallback to first explicit route. */
  const preferred = routes.find((route) => route.subdomain === null) ?? routes[0];
  return preferred?.previewUrl ?? `https://${buildProjectDomain(slug, publicDomain, null)}`;
};

export const normalizeRuntimeRoutes = (
  value: ProjectRuntimeRoutePatch[] | ProjectRuntimeRoute[] | null | undefined
): ProjectRuntimeRoute[] => {
  /* API/store payloads must normalize optional strings and ports before persistence. */
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((route, index) => ({
    id: requireRouteId(route.id, index),
    mode: route.mode === "static" ? "static" : "docker",
    serviceName: normalizeNullableString(route.serviceName),
    internalPort: normalizeNullablePort(route.internalPort),
    staticRoot: normalizeNullableString(route.staticRoot),
    subdomain: normalizeNullableString(route.subdomain)
  }));
};

export const assertRuntimeRoutes = (routes: ProjectRuntimeRoute[]): void => {
  /* Explicit route config must not contain duplicate ids or conflicting subdomain assignments. */
  const ids = new Set<string>();
  const hosts = new Set<string>();

  routes.forEach((route) => {
    if (ids.has(route.id)) {
      throw new Error(`Duplicate route id: ${route.id}`);
    }
    ids.add(route.id);

    const hostKey = route.subdomain ?? "<primary>";
    if (hosts.has(hostKey)) {
      throw new Error(`Duplicate route subdomain: ${hostKey}`);
    }
    hosts.add(hostKey);

    if (route.mode === "static") {
      if (!route.staticRoot) {
        throw new Error(`Set staticRoot for static route '${route.id}'`);
      }
      return;
    }

    if (!route.serviceName) {
      throw new Error(`Set serviceName for docker route '${route.id}'`);
    }
  });
};

export const buildSettingsFromRoutes = (input: {
  routes: ProjectRuntimeRoute[];
  fallbackMode: ProjectRuntimeSettings["mode"];
}): ProjectRuntimeSettings => {
  /* Legacy top-level fields mirror the primary route so older UI consumers still get sane values. */
  const primaryRoute = input.routes.find((route) => route.subdomain === null) ?? input.routes[0];
  return {
    mode: primaryRoute?.mode ?? input.fallbackMode,
    serviceName: primaryRoute?.mode === "docker" ? primaryRoute.serviceName : null,
    internalPort: primaryRoute?.mode === "docker" ? primaryRoute.internalPort : null,
    staticRoot: primaryRoute?.mode === "static" ? primaryRoute.staticRoot : null,
    routes: input.routes
  };
};

export const toEffectiveRoutes = (settings: ProjectRuntimeSettings): ProjectRuntimeRoute[] => {
  /* Advanced route config takes precedence; legacy fields still map to one primary route. */
  if ((settings.routes ?? []).length > 0) {
    return settings.routes ?? [];
  }

  return [
    {
      id: "web",
      mode: settings.mode,
      serviceName: settings.serviceName,
      internalPort: settings.internalPort,
      staticRoot: settings.staticRoot,
      subdomain: null
    }
  ];
};

export const toRouteSnapshots = (
  slug: string,
  publicDomain: string,
  settings: ProjectRuntimeSettings
): ProjectRuntimeRouteSnapshot[] => {
  /* Snapshot payload exposes every routed subdomain with a ready-to-open preview URL. */
  return toEffectiveRoutes(settings).map((route) => ({
    ...route,
    previewUrl: `https://${buildProjectDomain(slug, publicDomain, route.subdomain)}`
  }));
};
