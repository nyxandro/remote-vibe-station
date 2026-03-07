/**
 * @fileoverview Types for per-project runtime deployment settings.
 *
 * Exports:
 * - ProjectRuntimeMode - Supported runtime modes for project deployment.
 * - ProjectRuntimeRoute - One public ingress target for remote dev deployment.
 * - ProjectRuntimeRoutePatch - Partial route payload accepted from API.
 * - ProjectRuntimeRouteSnapshot - Route payload enriched with preview URL.
 * - ProjectRuntimeSettings - Persisted settings used by deploy service.
 * - ProjectRuntimeSettingsPatch - Partial update payload for settings API.
 * - ProjectRuntimeSnapshot - API payload for settings + runtime state.
 */

export type ProjectRuntimeMode = "docker" | "static";

export type ProjectRuntimeRoute = {
  id: string;
  mode: ProjectRuntimeMode;
  serviceName: string | null;
  internalPort: number | null;
  staticRoot: string | null;
  subdomain: string | null;
  pathPrefix: string | null;
};

export type ProjectRuntimeRoutePatch = {
  id?: string | null;
  mode?: ProjectRuntimeMode;
  serviceName?: string | null;
  internalPort?: number | null;
  staticRoot?: string | null;
  subdomain?: string | null;
  pathPrefix?: string | null;
};

export type ProjectRuntimeRouteSnapshot = ProjectRuntimeRoute & {
  previewUrl: string;
};

export type ProjectRuntimeSettings = {
  mode: ProjectRuntimeMode;
  serviceName: string | null;
  internalPort: number | null;
  staticRoot: string | null;
  routes?: ProjectRuntimeRoute[];
};

export type ProjectRuntimeSettingsPatch = {
  mode?: ProjectRuntimeMode;
  serviceName?: string | null;
  internalPort?: number | null;
  staticRoot?: string | null;
  routes?: ProjectRuntimeRoutePatch[];
};

export type ProjectRuntimeSnapshot = {
  slug: string;
  mode: ProjectRuntimeMode;
  serviceName: string | null;
  internalPort: number | null;
  staticRoot: string | null;
  availableServices: string[];
  previewUrl: string;
  routes: ProjectRuntimeRouteSnapshot[];
  deployed: boolean;
};
