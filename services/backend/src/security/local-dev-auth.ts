/**
 * @fileoverview Helpers for explicit localhost-only auth bypass in isolated dev sessions.
 *
 * Exports:
 * - LOCAL_DEV_HOSTNAMES - Hostnames that count as local loopback targets.
 * - isLocalDevHost - Checks whether a hostname/host header points to localhost.
 * - isUnsafeLocalRequestAllowed - Allows bypass only when config opt-in is enabled and request target is local.
 */

import { Request } from "express";

import { AppConfig } from "../config/config.types";

export const LOCAL_DEV_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const normalizeHostLikeValue = (value: string | undefined): string | null => {
  /* Proxies may append ports or comma-separated forwarded hosts, so we normalize once before any localhost checks. */
  const firstSegment = String(value ?? "")
    .split(",")[0]
    ?.trim();
  if (!firstSegment) {
    return null;
  }

  /* IPv6 loopback is usually bracketed in headers; remove brackets before hostname comparison. */
  if (firstSegment.startsWith("[")) {
    const closingBracketIndex = firstSegment.indexOf("]");
    if (closingBracketIndex > 1) {
      return firstSegment.slice(1, closingBracketIndex).toLowerCase();
    }
  }

  /* Unbracketed IPv6 loopback has multiple colons and no trailing port syntax we can safely strip here. */
  if ((firstSegment.match(/:/g) ?? []).length > 1) {
    return firstSegment.toLowerCase();
  }

  /* Plain host headers may include a trailing port; strip it but keep the actual hostname intact. */
  return firstSegment.replace(/:\d+$/, "").toLowerCase();
};

const readHostnameFromUrl = (value: string | undefined): string | null => {
  /* Config may still point to localhost, so URL parsing keeps that legacy bypass path working. */
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export const isLocalDevHost = (value: string | undefined): boolean => {
  /* Only loopback hosts qualify; remote domains must never inherit the unsafe bypass. */
  const normalized = normalizeHostLikeValue(value);
  return normalized ? LOCAL_DEV_HOSTNAMES.has(normalized) : false;
};

export const isUnsafeLocalRequestAllowed = (input: { request: Request; config: AppConfig }): boolean => {
  /* Unsafe bypass stays impossible unless the operator enabled it explicitly in env/config. */
  if (!input.config.allowUnsafeLocalAuth) {
    return false;
  }

  /* Preserve the old localhost PUBLIC_BASE_URL behavior for pure local stacks. */
  const publicBaseUrlHost = readHostnameFromUrl(input.config.publicBaseUrl);
  if (publicBaseUrlHost && LOCAL_DEV_HOSTNAMES.has(publicBaseUrlHost)) {
    return true;
  }

  /* Mini App nginx forwards the original host header, so loopback host checks do not need trust-sensitive proxy headers. */
  if (typeof input.request.headers?.host === "string" && isLocalDevHost(input.request.headers.host)) {
    return true;
  }

  return false;
};
