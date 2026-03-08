/**
 * @fileoverview Pure helpers for deployment runtime inference and override generation.
 *
 * Exports:
 * - DockerComposeConfig - minimal compose JSON schema used for inference.
 * - inferDockerRuntimeTarget - resolves service and internal port for runtime routing.
 * - buildDockerOverrideConfig - builds compose override for single-route docker deploys.
 * - buildMultiRouteOverrideConfig - builds compose override for multi-route shared-VDS deploys.
 * - buildStaticComposeConfig - builds compose config for static HTML mode.
 * - inferServicePathPrefix - extracts reusable legacy path prefixes from Traefik rules.
 * - resolveRouteServicePathPrefix - applies inferred legacy prefixes only to compatible public routes.
 * - toComposeProjectName - normalizes slug for docker compose project names.
 * - toDockerRouteProxyServiceName - returns deterministic sidecar names for routed docker services.
 */

import { ProjectRuntimeSettings } from "./project-runtime.types";

export type DockerComposeConfig = {
  services?: Record<
    string,
    {
      ports?: Array<string | { target?: number }>;
      expose?: Array<string | number>;
      networks?: Record<string, unknown> | string[];
      labels?: string[] | Record<string, string>;
    }
  >;
};

const MIN_PORT = 1;
const MAX_PORT = 65535;
const COMPOSE_NAME_INVALID_CHAR_REGEX = /[^a-z0-9_-]/g;
const ROUTE_KEY_INVALID_CHAR_REGEX = /[^a-z0-9_-]/g;
const DOCKER_ROUTE_PROXY_IMAGE = "nginx:alpine";
const DOCKER_ROUTE_PROXY_PORT = 80;
type DockerRoutePathRewriteMode = "none" | "prepend" | "strip";

const normalizePathPrefix = (value: string | null): string | null => {
  /* Rewrites should not generate duplicate slashes when callers pass a trailing slash. */
  if (!value) {
    return null;
  }

  const trimmed = value.endsWith("/") && value !== "/" ? value.replace(/\/+$/g, "") : value;
  return trimmed.length > 0 ? trimmed : null;
};

export const resolveRouteServicePathPrefix = (input: {
  routePathPrefix: string | null | undefined;
  inferredServicePathPrefix: string | null;
}): string | null => {
  /* Reuse legacy upstream path prefixes only when the public route matches that same prefix or has no explicit prefix. */
  const normalizedInferred = normalizePathPrefix(input.inferredServicePathPrefix);
  if (!normalizedInferred) {
    return null;
  }

  const normalizedRoute = normalizePathPrefix(input.routePathPrefix ?? null);
  if (!normalizedRoute) {
    return normalizedInferred;
  }

  return normalizedRoute === normalizedInferred ? normalizedInferred : null;
};

const escapeNginxRegex = (value: string): string => {
  /* Prefixes become part of nginx regex checks, so escape meta characters deterministically. */
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const inferDockerRoutePathRewriteMode = (input: {
  pathPrefix: string | null;
  upstreamPort: number;
}): DockerRoutePathRewriteMode => {
  /* Static nginx-style services typically need prefix stripping, while app servers expect prefixed upstream paths. */
  if (!input.pathPrefix) {
    return "none";
  }
  return input.upstreamPort === 80 ? "strip" : "prepend";
};

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
  routePathPrefix?: string | null;
  targetServiceName: string;
  internalPort: number;
  existingNetworks: string[];
  allServices: string[];
  servicePathPrefix?: string | null;
}): Record<string, unknown> => {
  /* Disable host ports for all services and expose target service through an isolated proxy sidecar. */
  const services: Record<string, Record<string, unknown>> = {};
  input.allServices.forEach((serviceName) => {
    services[serviceName] = {
      ports: []
    };
  });

  services[toDockerRouteProxyServiceName(input.slug, null)] = buildDockerRouteProxyService({
    domain: input.domain,
    routePathPrefix: input.routePathPrefix ?? null,
    routeKey: input.slug,
    upstreamServiceName: input.targetServiceName,
    upstreamPort: input.internalPort,
    existingNetworks: input.existingNetworks,
    pathPrefix: input.servicePathPrefix ?? null
  });

  return {
    services,
    networks: {
      public: {
        external: true
      }
    }
  };
};

export const buildMultiRouteOverrideConfig = (input: {
  slug: string;
  allServices: string[];
  dockerRoutes: Array<{
    routeId: string;
    domain: string;
    routePathPrefix?: string | null;
    targetServiceName: string;
    internalPort: number;
    existingNetworks: string[];
    servicePathPrefix?: string | null;
  }>;
  staticRoutes: Array<{
    routeId: string;
    domain: string;
    staticPath: string;
  }>;
}): Record<string, unknown> => {
  /* Shared-VDS deploys need one override that publishes multiple routed services without host port collisions. */
  const services: Record<string, Record<string, unknown>> = {};
  const knownServiceNames = new Set(input.allServices);

  input.allServices.forEach((serviceName) => {
    services[serviceName] = {
      ports: []
    };
  });

  input.dockerRoutes.forEach((route) => {
    if (!knownServiceNames.has(route.targetServiceName)) {
      throw new Error(`Docker route '${route.routeId}' targets unknown service '${route.targetServiceName}'`);
    }

    const routeKey = toRouteLabelKey(input.slug, route.routeId);
    const proxyServiceName = toDockerRouteProxyServiceName(input.slug, route.routeId);
    if (knownServiceNames.has(proxyServiceName) || Object.hasOwn(services, proxyServiceName)) {
      throw new Error(`Docker route '${route.routeId}' conflicts with service '${proxyServiceName}'`);
    }

    services[proxyServiceName] = buildDockerRouteProxyService({
      domain: route.domain,
      routePathPrefix: route.routePathPrefix ?? null,
      routeKey,
      upstreamServiceName: route.targetServiceName,
      upstreamPort: route.internalPort,
      existingNetworks: route.existingNetworks,
      pathPrefix: route.servicePathPrefix ?? null
    });
  });

  input.staticRoutes.forEach((route) => {
    const routeKey = toRouteLabelKey(input.slug, route.routeId);
    const staticServiceName = `static-${routeKey}`;
    if (knownServiceNames.has(staticServiceName) || Object.hasOwn(services, staticServiceName)) {
      throw new Error(`Static route '${route.routeId}' conflicts with service '${staticServiceName}'`);
    }

    services[staticServiceName] = {
      image: "nginx:alpine",
      restart: "unless-stopped",
      volumes: [`${route.staticPath}:/usr/share/nginx/html:ro`],
      labels: [
        "traefik.enable=true",
        `traefik.http.routers.${routeKey}.rule=Host(\`${route.domain}\`)`,
        `traefik.http.routers.${routeKey}.entrypoints=websecure`,
        `traefik.http.routers.${routeKey}.tls=true`,
        `traefik.http.routers.${routeKey}.tls.certresolver=le`,
        `traefik.http.routers.${routeKey}.middlewares=noindex-headers@file`,
        `traefik.http.routers.${routeKey}.service=${routeKey}`,
        `traefik.http.services.${routeKey}.loadbalancer.server.port=80`,
        "traefik.docker.network=public"
      ],
      networks: ["public"]
    };
  });

  return {
    services,
    networks: {
      public: {
        external: true
      }
    }
  };
};

const labelsToArray = (value: string[] | Record<string, string> | undefined): string[] => {
  /* Compose config may serialize labels as array or object; normalize both forms for inspection. */
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, entryValue]) => `${key}=${entryValue}`);
  }
  return [];
};

export const inferServicePathPrefix = (service: {
  labels?: string[] | Record<string, string>;
}): string | null => {
  /* Reuse one deterministic legacy PathPrefix when a project was originally mounted under a path instead of a subdomain. */
  const prefixes = Array.from(
    new Set(
      labelsToArray(service.labels)
        .map((entry) => {
          const [, value = ""] = entry.split(/=(.*)/s, 2);
          const match = value.match(/PathPrefix\(`([^`]+)`\)/);
          return match?.[1] ?? null;
        })
        .filter((item): item is string => typeof item === "string" && item.startsWith("/"))
    )
  );

  return prefixes.length === 1 ? prefixes[0] : null;
};

const buildDockerRouteProxyService = (input: {
  domain: string;
  routePathPrefix: string | null;
  routeKey: string;
  upstreamServiceName: string;
  upstreamPort: number;
  existingNetworks: string[];
  pathPrefix: string | null;
}): Record<string, unknown> => {
  /* Dedicated HTTP proxies isolate platform Traefik labels from project-owned labels and routers. */
  const normalizedPathPrefix = normalizePathPrefix(input.pathPrefix);
  const rewriteMode = inferDockerRoutePathRewriteMode({
    pathPrefix: normalizedPathPrefix,
    upstreamPort: input.upstreamPort
  });
  const escapedPathPrefix = normalizedPathPrefix ? escapeNginxRegex(normalizedPathPrefix) : null;
  const guardedRewriteBlock =
    rewriteMode === "prepend" && normalizedPathPrefix && escapedPathPrefix
      ? [
          `    if ($$uri !~ ^${escapedPathPrefix}(?:/|$$)) {`,
          `      rewrite ^/(.*)$ ${normalizedPathPrefix}/$1 break;`,
          "    }"
        ]
      : rewriteMode === "strip" && normalizedPathPrefix && escapedPathPrefix
        ? [`    rewrite ^${escapedPathPrefix}/?(.*)$ /$1 break;`]
        : [];
  return {
    image: DOCKER_ROUTE_PROXY_IMAGE,
    restart: "unless-stopped",
    depends_on: [input.upstreamServiceName],
    command: [
      "sh",
      "-lc",
      [
        "cat <<'EOF' >/etc/nginx/conf.d/default.conf",
        "map $$http_upgrade $$connection_upgrade {",
        "  default upgrade;",
        "  '' close;",
        "}",
        "",
        "server {",
        `  listen ${DOCKER_ROUTE_PROXY_PORT};`,
        "  server_name _;",
        "",
        "  location / {",
        ...guardedRewriteBlock,
        `    proxy_pass http://${input.upstreamServiceName}:${input.upstreamPort};`,
        "    proxy_http_version 1.1;",
        "    proxy_set_header Host $$host;",
        "    proxy_set_header X-Real-IP $$remote_addr;",
        "    proxy_set_header X-Forwarded-For $$proxy_add_x_forwarded_for;",
        "    proxy_set_header X-Forwarded-Proto $$scheme;",
        "    proxy_set_header Upgrade $$http_upgrade;",
        "    proxy_set_header Connection $$connection_upgrade;",
        "  }",
        "}",
        "EOF",
        "nginx -g 'daemon off;'"
      ].join("\n")
    ],
    labels: [
      "traefik.enable=true",
      buildDockerRouteRule(input.routeKey, input.domain, input.routePathPrefix),
      `traefik.http.routers.${input.routeKey}.entrypoints=websecure`,
      `traefik.http.routers.${input.routeKey}.tls=true`,
      `traefik.http.routers.${input.routeKey}.tls.certresolver=le`,
      `traefik.http.routers.${input.routeKey}.middlewares=noindex-headers@file`,
      `traefik.http.routers.${input.routeKey}.service=${input.routeKey}`,
      `traefik.http.services.${input.routeKey}.loadbalancer.server.port=${DOCKER_ROUTE_PROXY_PORT}`,
      "traefik.docker.network=public"
    ],
    networks: Array.from(new Set([...(input.existingNetworks.length > 0 ? input.existingNetworks : ["default"]), "public"]))
  };
};

const buildDockerRouteRule = (routeKey: string, domain: string, routePathPrefix: string | null): string => {
  /* Public route rules combine host routing with optional shared-host path routing. */
  return routePathPrefix
    ? `traefik.http.routers.${routeKey}.rule=Host(\`${domain}\`) && PathPrefix(\`${routePathPrefix}\`)`
    : `traefik.http.routers.${routeKey}.rule=Host(\`${domain}\`)`;
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
          `traefik.http.routers.${input.slug}.tls=true`,
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

export const toDockerRouteProxyServiceName = (slug: string, routeId: string | null): string => {
  /* Dedicated proxy service names must stay deterministic across deploy/restart cycles. */
  const routeKey = routeId ? toRouteLabelKey(slug, routeId) : toComposeProjectName(slug);
  return `proxy-${routeKey}`;
};

const toRouteLabelKey = (slug: string, routeId: string): string => {
  /* Route ids become part of Traefik router/service keys, so keep them deterministic and safe. */
  const normalizedSlug = toComposeProjectName(slug);
  const normalizedRouteId = routeId.toLowerCase().replace(ROUTE_KEY_INVALID_CHAR_REGEX, "-") || "route";
  return `${normalizedSlug}-${normalizedRouteId}`;
};
