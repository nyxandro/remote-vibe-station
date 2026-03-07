/**
 * @fileoverview Heuristics for agent-first remote dev route autoconfiguration.
 *
 * Exports:
 * - buildSuggestedRuntimeRoutes - Infers stable public routes from compose services.
 */

import { DockerComposeConfig, inferDockerRuntimeTarget } from "./project-deployment-runtime";
import { ProjectRuntimeRoute } from "./project-runtime.types";

const PRIMARY_SERVICE_CANDIDATES = ["frontend", "front", "web", "app", "client", "site", "ui"];
const API_SERVICE_CANDIDATES = ["api", "backend", "server", "gateway"];
const ADMIN_SERVICE_CANDIDATES = ["admin", "dashboard", "cms", "studio"];
const INFRA_SERVICE_TOKENS = ["db", "postgres", "postgresql", "mysql", "mariadb", "mongo", "mongodb", "redis", "rabbitmq", "kafka", "queue", "worker", "cron", "mailhog", "minio"];

export const buildSuggestedRuntimeRoutes = (compose: DockerComposeConfig): ProjectRuntimeRoute[] => {
  /* Keep autoconfig deterministic so the agent can safely apply it without interactive questions. */
  const descriptors = Object.keys(compose.services ?? {})
    .sort((left, right) => left.localeCompare(right))
    .map((serviceName) => {
      try {
        const target = inferDockerRuntimeTarget({
          compose,
          settings: {
            mode: "docker",
            serviceName,
            internalPort: null,
            staticRoot: null,
            routes: []
          }
        });
        return {
          serviceName,
          internalPort: target.internalPort,
          tokens: tokenizeServiceName(serviceName)
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is { serviceName: string; internalPort: number; tokens: string[] } => item !== null)
    .filter((item) => !hasAnyToken(item.tokens, INFRA_SERVICE_TOKENS));

  if (descriptors.length === 0) {
    return [];
  }

  const primary =
    pickByTokens(descriptors, PRIMARY_SERVICE_CANDIDATES) ??
    (descriptors.length === 1 ? descriptors[0] : null) ??
    descriptors[0];

  const routes: ProjectRuntimeRoute[] = [toDockerRoute("web", primary.serviceName, primary.internalPort, null)];
  const usedServices = new Set<string>([primary.serviceName]);

  const api = pickByTokens(descriptors, API_SERVICE_CANDIDATES, usedServices);
  if (api) {
    routes.push(toDockerRoute("api", api.serviceName, api.internalPort, "api"));
    usedServices.add(api.serviceName);
  }

  const admin = pickByTokens(descriptors, ADMIN_SERVICE_CANDIDATES, usedServices);
  if (admin) {
    routes.push(toDockerRoute("admin", admin.serviceName, admin.internalPort, "admin"));
  }

  return routes;
};

const tokenizeServiceName = (serviceName: string): string[] => {
  /* Split common docker service naming styles into normalized tokens for role matching. */
  return serviceName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
};

const hasAnyToken = (tokens: string[], candidates: string[]): boolean => {
  /* Exact token matching avoids accidental infra misclassification for names like web-admin. */
  return tokens.some((token) => candidates.includes(token));
};

const pickByTokens = (
  descriptors: Array<{ serviceName: string; internalPort: number; tokens: string[] }>,
  candidates: string[],
  usedServices?: Set<string>
): { serviceName: string; internalPort: number; tokens: string[] } | null => {
  /* Reuse one deterministic selector for primary/api/admin route roles. */
  return (
    descriptors.find((item) => !usedServices?.has(item.serviceName) && hasAnyToken(item.tokens, candidates)) ?? null
  );
};

const toDockerRoute = (
  id: string,
  serviceName: string,
  internalPort: number,
  subdomain: string | null
): ProjectRuntimeRoute => {
  /* Autoconfig generates docker routes only; static routes still require explicit user intent. */
  return {
    id,
    mode: "docker",
    serviceName,
    internalPort,
    staticRoot: null,
    subdomain
  };
};
