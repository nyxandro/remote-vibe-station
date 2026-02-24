/**
 * @fileoverview Pure helpers for deployment runtime inference and override generation.
 *
 * Exports:
 * - DockerComposeConfig (L13) - Minimal compose JSON schema used for inference.
 * - inferDockerRuntimeTarget (L49) - Resolves service and internal port for Traefik.
 * - buildDockerOverrideConfig (L108) - Builds compose override with Traefik labels.
 * - buildStaticComposeConfig (L181) - Builds compose config for static HTML mode.
 * - toComposeProjectName (L220) - Normalizes slug for docker compose `-p`.
 */

import { ProjectRuntimeSettings } from "./project-runtime.types";

export type DockerComposeConfig = {
  services?: Record<
    string,
    {
      ports?: Array<string | { target?: number }>;
      expose?: Array<string | number>;
      networks?: Record<string, unknown> | string[];
    }
  >;
};

const MIN_PORT = 1;
const MAX_PORT = 65535;
const COMPOSE_NAME_INVALID_CHAR_REGEX = /[^a-z0-9_-]/g;

const parsePortValue = (value: unknown): number | null => {
  /* Accept numeric or string port tokens and reject invalid ranges. */
  const normalized =
    typeof value === "string"
      ? value
          .trim()
          .split("/")[0]
      : value;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < MIN_PORT || parsed > MAX_PORT) {
    return null;
  }
  return parsed;
};

export const inferDockerRuntimeTarget = (input: {
  compose: DockerComposeConfig;
  settings: ProjectRuntimeSettings;
}): {
  serviceName: string;
  internalPort: number;
  existingNetworks: string[];
  allServices: string[];
} => {
  /* Resolve deployment target from explicit settings or deterministic compose inference. */
  const services = input.compose.services ?? {};
  const serviceNames = Object.keys(services).sort((a, b) => a.localeCompare(b));
  if (serviceNames.length === 0) {
    throw new Error("Compose file has no services. Add at least one service for docker deploy mode");
  }

  const serviceName =
    input.settings.serviceName && input.settings.serviceName.trim().length > 0
      ? input.settings.serviceName.trim()
      : serviceNames.length === 1
        ? serviceNames[0]
        : "";

  if (!serviceName) {
    throw new Error("Set serviceName in project runtime settings (multiple services detected)");
  }

  const service = services[serviceName];
  if (!service) {
    throw new Error(`Service '${serviceName}' is missing in compose config`);
  }

  const existingNetworks = Array.isArray(service.networks)
    ? service.networks.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : Object.keys(service.networks ?? {});

  if (input.settings.internalPort) {
    return {
      serviceName,
      internalPort: input.settings.internalPort,
      existingNetworks,
      allServices: serviceNames
    };
  }

  /* Prefer expose/target ports because host-published ports are intentionally disabled. */
  const exposePort = (service.expose ?? []).map((item) => parsePortValue(item)).find((item) => item !== null);
  if (exposePort) {
    return {
      serviceName,
      internalPort: exposePort,
      existingNetworks,
      allServices: serviceNames
    };
  }

  const targetPort = (service.ports ?? [])
    .map((item) => {
      if (typeof item === "string") {
        const rightSide = item.split(":").at(-1) ?? "";
        return parsePortValue(rightSide);
      }
      return parsePortValue(item.target);
    })
    .find((item) => item !== null);

  if (!targetPort) {
    throw new Error(`Cannot infer internal port for service '${serviceName}'. Set internalPort in runtime settings`);
  }

  return {
    serviceName,
    internalPort: targetPort,
    existingNetworks,
    allServices: serviceNames
  };
};

export const buildDockerOverrideConfig = (input: {
  slug: string;
  domain: string;
  targetServiceName: string;
  internalPort: number;
  existingNetworks: string[];
  allServices: string[];
}): Record<string, unknown> => {
  /* Disable host ports for all services and expose target service via Traefik host routing. */
  const services: Record<string, Record<string, unknown>> = {};
  input.allServices.forEach((serviceName) => {
    services[serviceName] = {
      ports: []
    };
  });

  const targetNetworks = Array.from(
    new Set([
      ...(input.existingNetworks.length > 0 ? input.existingNetworks : ["default"]),
      "public"
    ])
  );

  services[input.targetServiceName] = {
    ...(services[input.targetServiceName] ?? {}),
    labels: [
      "traefik.enable=true",
      `traefik.http.routers.${input.slug}.rule=Host(\`${input.domain}\`)`,
      `traefik.http.routers.${input.slug}.entrypoints=websecure`,
      `traefik.http.routers.${input.slug}.tls.certresolver=le`,
      `traefik.http.routers.${input.slug}.middlewares=noindex-headers@file`,
      `traefik.http.services.${input.slug}.loadbalancer.server.port=${input.internalPort}`,
      "traefik.docker.network=public"
    ],
    networks: targetNetworks
  };

  return {
    services,
    networks: {
      public: {
        external: true
      }
    }
  };
};

export const buildStaticComposeConfig = (input: {
  slug: string;
  domain: string;
  staticPath: string;
}): Record<string, unknown> => {
  /* Serve static project folder through nginx with Traefik domain routing. */
  return {
    services: {
      static: {
        image: "nginx:alpine",
        restart: "unless-stopped",
        volumes: [`${input.staticPath}:/usr/share/nginx/html:ro`],
        labels: [
          "traefik.enable=true",
          `traefik.http.routers.${input.slug}.rule=Host(\`${input.domain}\`)`,
          `traefik.http.routers.${input.slug}.entrypoints=websecure`,
          `traefik.http.routers.${input.slug}.tls.certresolver=le`,
          `traefik.http.routers.${input.slug}.middlewares=noindex-headers@file`,
          `traefik.http.services.${input.slug}.loadbalancer.server.port=80`,
          "traefik.docker.network=public"
        ],
        networks: ["public"]
      }
    },
    networks: {
      public: {
        external: true
      }
    }
  };
};

export const toComposeProjectName = (slug: string): string => {
  /* Compose project names are restricted to [a-z0-9_-] and must be non-empty. */
  const normalized = slug.toLowerCase().replace(COMPOSE_NAME_INVALID_CHAR_REGEX, "-");
  if (!normalized) {
    return "project";
  }

  const firstChar = normalized[0];
  if (/[a-z0-9]/.test(firstChar)) {
    return normalized;
  }

  return `p${normalized}`;
};
