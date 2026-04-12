/**
 * @fileoverview VLESS URL parsing and xray config rendering helpers.
 *
 * Exports:
 * - ParsedVlessConfig - Normalized VLESS URL fields needed for xray runtime generation.
 * - parseVlessConfigUrl - Validates and normalizes a broad set of VLESS URL variants.
 * - renderXrayConfig - Produces xray inbound/outbound JSON for the local VLESS proxy sidecar.
 * - renderDisabledXrayConfig - Produces a safe no-op xray config for direct mode.
 */

import { BadRequestException } from "@nestjs/common";

type StreamType = "tcp" | "ws" | "grpc" | "http" | "httpupgrade" | "splithttp";
type SecurityType = "none" | "tls" | "reality";

export type ParsedVlessConfig = {
  uuid: string;
  hostname: string;
  port: number;
  security: SecurityType;
  type: StreamType;
  sni: string;
  publicKey: string;
  fingerprint: string;
  flow: string;
  shortId: string;
  spiderX: string;
  path: string;
  host: string;
  authority: string;
  serviceName: string;
  headerType: string;
  alpn: string[];
  allowInsecure: boolean;
};

const SUPPORTED_TYPES: StreamType[] = ["tcp", "ws", "grpc", "http", "httpupgrade", "splithttp"];
const SUPPORTED_SECURITIES: SecurityType[] = ["none", "tls", "reality"];

const readFirst = (value: string | null, fallback = ""): string => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
};

const decodePath = (value: string): string => {
  if (!value) {
    return "/";
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return decodeURIComponent(withLeadingSlash);
};

export const parseVlessConfigUrl = (value: string): ParsedVlessConfig => {
  /* Normalize many common VLESS share-link variants into one shape suitable for xray rendering. */
  if (!value.startsWith("vless://")) {
    throw new BadRequestException("vlessConfigUrl must start with vless://");
  }

  const parsed = new URL(value);
  const uuid = readFirst(parsed.username);
  const hostname = readFirst(parsed.hostname);
  const port = Number(readFirst(parsed.port, "443"));
  const security = readFirst(parsed.searchParams.get("security"), "none") as SecurityType;
  const type = readFirst(parsed.searchParams.get("type"), "tcp").toLowerCase() as StreamType;
  const sni = readFirst(parsed.searchParams.get("sni"), readFirst(parsed.searchParams.get("serverName")));
  const publicKey = readFirst(parsed.searchParams.get("pbk"), readFirst(parsed.searchParams.get("publicKey")));
  const fingerprint = readFirst(parsed.searchParams.get("fp"), "chrome");
  const flow = readFirst(parsed.searchParams.get("flow"));
  const shortId = readFirst(parsed.searchParams.get("sid"), readFirst(parsed.searchParams.get("shortId")));
  const spiderX = readFirst(parsed.searchParams.get("spx"), "/");
  const path = decodePath(readFirst(parsed.searchParams.get("path"), readFirst(parsed.searchParams.get("serviceName"))));
  const host = readFirst(parsed.searchParams.get("host"), readFirst(parsed.searchParams.get("authority")));
  const authority = readFirst(parsed.searchParams.get("authority"), host);
  const serviceName = readFirst(parsed.searchParams.get("serviceName"), parsed.pathname.replace(/^\//, ""));
  const headerType = readFirst(parsed.searchParams.get("headerType"));
  const alpn = readFirst(parsed.searchParams.get("alpn"))
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowInsecure = readFirst(parsed.searchParams.get("allowInsecure")) === "1";

  if (!uuid || !hostname || !Number.isInteger(port) || port <= 0) {
    throw new BadRequestException("vlessConfigUrl must include uuid, host and port");
  }

  if (!SUPPORTED_SECURITIES.includes(security)) {
    throw new BadRequestException(`vlessConfigUrl security '${security}' is unsupported`);
  }

  if (!SUPPORTED_TYPES.includes(type)) {
    throw new BadRequestException(`vlessConfigUrl type '${type}' is unsupported`);
  }

  if (security === "reality" && (!sni || !publicKey)) {
    throw new BadRequestException("vlessConfigUrl with reality security must include sni and pbk");
  }

  if (security === "tls" && !sni) {
    throw new BadRequestException("vlessConfigUrl with tls security must include sni");
  }

  if ((type === "ws" || type === "httpupgrade" || type === "splithttp") && path.length === 0) {
    throw new BadRequestException(`vlessConfigUrl type '${type}' must include path`);
  }

  if (type === "grpc" && !serviceName) {
    throw new BadRequestException("vlessConfigUrl type 'grpc' must include serviceName");
  }

  return {
    uuid,
    hostname,
    port,
    security,
    type,
    sni,
    publicKey,
    fingerprint,
    flow,
    shortId,
    spiderX,
    path,
    host,
    authority,
    serviceName,
    headerType,
    alpn,
    allowInsecure
  };
};

const buildTlsSettings = (parsed: ParsedVlessConfig) => {
  if (parsed.security === "none") {
    return undefined;
  }

  if (parsed.security === "reality") {
    return undefined;
  }

  return {
    serverName: parsed.sni,
    alpn: parsed.alpn.length > 0 ? parsed.alpn : undefined,
    allowInsecure: parsed.allowInsecure
  };
};

const buildRealitySettings = (parsed: ParsedVlessConfig) => {
  if (parsed.security !== "reality") {
    return undefined;
  }

  return {
    serverName: parsed.sni,
    fingerprint: parsed.fingerprint,
    publicKey: parsed.publicKey,
    shortId: parsed.shortId,
    spiderX: parsed.spiderX
  };
};

const buildTransportSettings = (parsed: ParsedVlessConfig) => {
  if (parsed.type === "ws") {
    return {
      wsSettings: {
        path: parsed.path,
        headers: parsed.host ? { Host: parsed.host } : undefined
      }
    };
  }

  if (parsed.type === "grpc") {
    return {
      grpcSettings: {
        serviceName: parsed.serviceName,
        authority: parsed.authority || undefined
      }
    };
  }

  if (parsed.type === "http") {
    return {
      httpSettings: {
        path: parsed.path,
        host: parsed.host ? [parsed.host] : undefined
      }
    };
  }

  if (parsed.type === "httpupgrade") {
    return {
      httpupgradeSettings: {
        path: parsed.path,
        host: parsed.host || undefined
      }
    };
  }

  if (parsed.type === "splithttp") {
    return {
      splitHTTPSettings: {
        path: parsed.path,
        host: parsed.host || undefined
      }
    };
  }

  return {
    tcpSettings: parsed.headerType ? { header: { type: parsed.headerType } } : undefined
  };
};

export const renderXrayConfig = (parsed: ParsedVlessConfig): string => {
  /* Build one local HTTP inbound and one remote VLESS outbound from the normalized link fields. */
  return JSON.stringify(
    {
      log: { loglevel: "warning" },
      inbounds: [
        {
          tag: "http-in",
          port: 8080,
          listen: "0.0.0.0",
          protocol: "http"
        }
      ],
      outbounds: [
        {
          tag: "proxy",
          protocol: "vless",
          settings: {
            vnext: [
              {
                address: parsed.hostname,
                port: parsed.port,
                users: [
                  {
                    id: parsed.uuid,
                    encryption: "none",
                    flow: parsed.flow || undefined
                  }
                ]
              }
            ]
          },
          streamSettings: {
            network: parsed.type,
            security: parsed.security,
            tlsSettings: buildTlsSettings(parsed),
            realitySettings: buildRealitySettings(parsed),
            ...buildTransportSettings(parsed)
          }
        },
        {
          tag: "direct",
          protocol: "freedom"
        }
      ]
    },
    null,
    2
  );
};

export const renderDisabledXrayConfig = (): string => {
  /* Keep direct mode config valid so runtime mounts never reference a missing/broken file. */
  return JSON.stringify(
    {
      log: { loglevel: "warning" },
      inbounds: [],
      outbounds: [{ protocol: "freedom", tag: "direct" }]
    },
    null,
    2
  );
};
