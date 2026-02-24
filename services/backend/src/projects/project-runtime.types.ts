/**
 * @fileoverview Types for per-project runtime deployment settings.
 *
 * Exports:
 * - ProjectRuntimeMode - Supported runtime modes for project deployment.
 * - ProjectRuntimeSettings - Persisted settings used by deploy service.
 * - ProjectRuntimeSettingsPatch - Partial update payload for settings API.
 * - ProjectRuntimeSnapshot - API payload for settings + runtime state.
 */

export type ProjectRuntimeMode = "docker" | "static";

export type ProjectRuntimeSettings = {
  mode: ProjectRuntimeMode;
  serviceName: string | null;
  internalPort: number | null;
  staticRoot: string | null;
};

export type ProjectRuntimeSettingsPatch = {
  mode?: ProjectRuntimeMode;
  serviceName?: string | null;
  internalPort?: number | null;
  staticRoot?: string | null;
};

export type ProjectRuntimeSnapshot = {
  slug: string;
  mode: ProjectRuntimeMode;
  serviceName: string | null;
  internalPort: number | null;
  staticRoot: string | null;
  availableServices: string[];
  previewUrl: string;
  deployed: boolean;
};
