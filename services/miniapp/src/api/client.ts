/**
 * @fileoverview API client for backend requests.
 *
 * Exports:
 * - BROWSER_SESSION_EXPIRED_EVENT - Window event emitted when browser bearer auth expires.
 * - readStoredWebTokenMetadata - Reads browser-token payload timestamps for refresh scheduling.
 * - clearStoredWebToken - Removes the current browser bearer token from session storage.
 * - bootstrapWebTokenFromTelegram - Exchanges Telegram initData into a sliding browser bearer token.
 * - refreshWebToken - Renews the current browser bearer token.
 * - apiGet - Authenticated GET helper that parses JSON responses.
 * - apiPost - Authenticated JSON POST helper.
 * - apiPostFormData - Authenticated multipart POST helper for file uploads.
 * - apiDelete - Authenticated JSON DELETE helper.
 * - apiDownload - Authenticated GET helper that returns a Blob for browser downloads.
 */

const INIT_DATA_HEADER = "x-telegram-init-data";
const STORAGE_KEY_WEB_TOKEN = "tvoc.miniapp.webToken";
const AUTHORIZATION_HEADER = "Authorization";
const JSON_CONTENT_TYPE = "application/json";
const BROWSER_WEB_TOKEN_BOOTSTRAP_PATH = "/api/auth/web-token/bootstrap";
const BROWSER_WEB_TOKEN_REFRESH_PATH = "/api/auth/web-token/refresh";
const BROWSER_SESSION_EXPIRY_CODES = new Set(["APP_AUTH_HEADER_INVALID", "APP_AUTH_REQUIRED", "APP_WEB_TOKEN_INVALID"]);

export const BROWSER_SESSION_EXPIRED_EVENT = "tvoc:browser-session-expired";

export type EventStreamTopic = "kanban" | "terminal" | "workspace";
export type BrowserWebTokenMetadata = {
  token: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

export type BrowserSessionExpiredDetail = {
  message: string;
};

type EventStreamTokenResponse = {
  token: string;
  expiresAt: string;
};

type WebTokenRefreshResponse = {
  token: string;
  expiresAt: string;
};

type BackendErrorResponse = {
  code?: string;
  message?: string | string[];
  hint?: string | null;
  requestId?: string;
};

type WebTokenPayload = {
  adminId: number;
  iat?: number;
  exp: number;
  nonce: string;
};

type ParsedBackendError = {
  code: string | null;
  message: string;
  hint: string | null;
  requestId: string | null;
};

const getInitData = (): string | undefined => {
  /* Read Telegram initData from WebApp context when available. */
  return (window as any)?.Telegram?.WebApp?.initData as string | undefined;
};

const removeHashParamFromLocation = (paramName: string): void => {
  /* Consuming one hash-based auth token must preserve unrelated launch params such as startapp deep links. */
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) {
    return;
  }

  const params = new URLSearchParams(hash);
  if (!params.has(paramName)) {
    return;
  }

  params.delete(paramName);
  const nextHash = params.toString();
  window.history.replaceState(
    null,
    document.title,
    `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`
  );
};

const readWebTokenFromLocation = (): string | null => {
  /* Support regular-browser Mini App launches where auth arrives through #token=... in the hash. */
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) {
    return null;
  }

  const params = new URLSearchParams(hash);
  const token = params.get("token");
  return token && token.trim().length > 0 ? token : null;
};

const storeWebToken = (token: string): void => {
  /* Keep the active browser bearer token scoped to one tab session. */
  sessionStorage.setItem(STORAGE_KEY_WEB_TOKEN, token);
};

export const clearStoredWebToken = (): void => {
  /* Explicitly clearing stale bearer auth prevents endless 401/retry loops after expiry. */
  sessionStorage.removeItem(STORAGE_KEY_WEB_TOKEN);
};

const getWebToken = (): string | undefined => {
  /* Keep browser token only for the current tab session to reduce exfiltration window. */
  const fromStorage = sessionStorage.getItem(STORAGE_KEY_WEB_TOKEN);
  if (fromStorage && fromStorage.trim().length > 0) {
    return fromStorage;
  }

  const fromHash = readWebTokenFromLocation();
  if (!fromHash) {
    return undefined;
  }

  storeWebToken(fromHash);
  removeHashParamFromLocation("token");
  return fromHash;
};

const decodeBase64UrlToString = (value: string): string | null => {
  /* Browser token payloads are plain JSON, so client-side timestamp reads only need safe base64url decoding. */
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
};

const safeJsonParse = (value: string): unknown | null => {
  /* Invalid token/error payload JSON should fail closed instead of surfacing syntax noise to the UI. */
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

export const readStoredWebTokenMetadata = (): BrowserWebTokenMetadata | null => {
  /* Refresh scheduling only depends on the currently stored token payload timestamps. */
  const token = getWebToken();
  if (!token) {
    return null;
  }

  const [payloadB64] = token.split(".");
  if (!payloadB64) {
    return null;
  }

  const payloadJson = decodeBase64UrlToString(payloadB64);
  if (!payloadJson) {
    return null;
  }

  const payload = safeJsonParse(payloadJson) as WebTokenPayload | null;
  if (!payload || typeof payload.exp !== "number") {
    return null;
  }

  return {
    token,
    issuedAtMs: typeof payload.iat === "number" ? payload.iat : 0,
    expiresAtMs: payload.exp
  };
};

const buildAuthHeaders = (): Record<string, string> => {
  /* Every Mini App request shares the same Telegram/browser auth header resolution. */
  const initData = getInitData();
  const webToken = getWebToken();
  const headers: Record<string, string> = {};

  if (webToken) {
    headers[AUTHORIZATION_HEADER] = `Bearer ${webToken}`;
    return headers;
  }

  if (initData) {
    headers[INIT_DATA_HEADER] = initData;
  }

  return headers;
};

const parseBackendErrorText = (text: string): ParsedBackendError => {
  /* Structured backend errors stay machine-readable, but raw text still needs a usable UI message. */
  let message = text;
  let code: string | null = null;
  let hint: string | null = null;
  let requestId: string | null = null;

  const parsed = safeJsonParse(text) as BackendErrorResponse | null;
  if (parsed && typeof parsed === "object") {
    const parsedMessage = Array.isArray(parsed.message)
      ? parsed.message.filter((item): item is string => typeof item === "string" && item.trim().length > 0).join("; ")
      : typeof parsed.message === "string"
        ? parsed.message.trim()
        : "";

    if (typeof parsed.code === "string" && parsed.code.trim().length > 0) {
      code = parsed.code.trim();
    }
    if (parsedMessage) {
      message = parsedMessage;
    }
    if (typeof parsed.hint === "string" && parsed.hint.trim().length > 0) {
      hint = parsed.hint.trim();
    }
    if (typeof parsed.requestId === "string" && parsed.requestId.trim().length > 0) {
      requestId = parsed.requestId.trim();
    }
  }

  return {
    code,
    message,
    hint,
    requestId
  };
};

const formatBackendErrorMessage = (status: number, error: ParsedBackendError): string => {
  /* One formatter keeps every fetch helper aligned on human-readable backend errors. */
  const suffix = [error.message, error.hint, error.requestId ? `[${error.requestId}]` : null].filter(Boolean).join(" ");
  return `Request failed: ${status}${suffix ? ` - ${suffix}` : ""}`;
};

const announceBrowserSessionExpired = (message: string): void => {
  /* Browser-mode screens must swap into a blocking overlay as soon as bearer auth is no longer trusted. */
  clearStoredWebToken();
  window.dispatchEvent(
    new CustomEvent<BrowserSessionExpiredDetail>(BROWSER_SESSION_EXPIRED_EVENT, {
      detail: { message }
    })
  );
};

const shouldEndBrowserSession = (status: number, error: ParsedBackendError): boolean => {
  /* Only browser bearer-token auth failures should end the browser session; Telegram initData should keep its own flow. */
  return status === 401 && Boolean(getWebToken()) && Boolean(error.code && BROWSER_SESSION_EXPIRY_CODES.has(error.code));
};

const buildErrorMessage = async (response: Response): Promise<string> => {
  /* Prefer backend-provided JSON message/hint while keeping raw text fallback for non-JSON failures. */
  const text = await response.text();
  const parsed = parseBackendErrorText(text);
  const message = formatBackendErrorMessage(response.status, parsed);
  if (shouldEndBrowserSession(response.status, parsed)) {
    announceBrowserSessionExpired(message);
  }
  return message;
};

const assertOk = async (response: Response): Promise<Response> => {
  /* Normalize backend errors into one consistent Error shape for UI hooks and tabs. */
  if (!response.ok) {
    throw new Error(await buildErrorMessage(response));
  }

  return response;
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  /* Empty responses still map to null so callers can use one generic helper across endpoints. */
  const text = await response.text();
  if (!text.trim()) {
    return null as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse JSON response: ${text.slice(0, 240)}`);
  }
};

export const apiGet = async <T>(path: string): Promise<T> => {
  /* Perform authenticated GET request. */
  const response = await assertOk(
    await fetch(path, {
      headers: buildAuthHeaders()
    })
  );

  return parseJsonResponse<T>(response);
};

export const apiPost = async <T>(path: string, body: unknown): Promise<T> => {
  /* Perform authenticated JSON POST request. */
  return apiWithJsonBody<T>(path, "POST", body);
};

export const apiPostFormData = async <T>(path: string, body: FormData): Promise<T> => {
  /* Multipart uploads rely on browser-managed boundary headers, so we only attach auth headers. */
  const response = await assertOk(
    await fetch(path, {
      method: "POST",
      headers: buildAuthHeaders(),
      body
    })
  );

  return parseJsonResponse<T>(response);
};

export const apiDelete = async <T>(path: string, body?: unknown): Promise<T> => {
  /* Perform authenticated DELETE request with optional JSON body for named resources. */
  return apiWithJsonBody<T>(path, "DELETE", body);
};

export const apiDownload = async (path: string): Promise<Blob> => {
  /* Download helper returns raw bytes so callers can trigger browser save dialogs themselves. */
  const response = await assertOk(
    await fetch(path, {
      headers: buildAuthHeaders()
    })
  );

  return response.blob();
};

export const refreshWebToken = async (): Promise<WebTokenRefreshResponse> => {
  /* Browser-only sessions renew through a dedicated endpoint so active tabs can outlive one token instance. */
  const response = await apiWithJsonBody<WebTokenRefreshResponse>(BROWSER_WEB_TOKEN_REFRESH_PATH, "POST", {});
  if (!response || typeof response.token !== "string" || response.token.trim().length === 0) {
    throw new Error(
      "APP_WEB_TOKEN_REFRESH_INVALID: Backend did not return a refreshed browser token. Keep the tab open and retry, or reopen the Mini App."
    );
  }

  storeWebToken(response.token);
  return response;
};

export const bootstrapWebTokenFromTelegram = async (): Promise<WebTokenRefreshResponse> => {
  /* Telegram Mini App sessions bootstrap bearer auth once so later requests no longer depend on expiring initData. */
  const initData = getInitData();
  if (typeof initData !== "string" || initData.trim().length === 0) {
    throw new Error(
      "APP_WEB_TOKEN_BOOTSTRAP_INIT_DATA_REQUIRED: Telegram initData is required to start a Mini App session token. Reopen the Mini App from Telegram and retry."
    );
  }

  const response = await assertOk(
    await fetch(BROWSER_WEB_TOKEN_BOOTSTRAP_PATH, {
      method: "POST",
      headers: {
        [INIT_DATA_HEADER]: initData,
        "Content-Type": JSON_CONTENT_TYPE
      },
      body: JSON.stringify({})
    })
  );

  const parsed = await parseJsonResponse<WebTokenRefreshResponse>(response);
  if (!parsed || typeof parsed.token !== "string" || parsed.token.trim().length === 0) {
    throw new Error(
      "APP_WEB_TOKEN_BOOTSTRAP_INVALID: Backend did not return a Mini App session token. Keep the tab open and retry, or reopen the Mini App."
    );
  }

  storeWebToken(parsed.token);
  return parsed;
};

export const getEventStreamUrl = async (input: {
  topics: EventStreamTopic[];
  projectSlug?: string | null;
}): Promise<string> => {
  /* Browser sockets cannot send auth headers, so first exchange HTTP auth into a short-lived WS token. */
  const response = await apiWithJsonBody<EventStreamTokenResponse>("/api/events/token", "POST", {
    topics: input.topics,
    projectSlug: input.projectSlug ?? null
  });
  if (!response || typeof response.token !== "string" || response.token.trim().length === 0) {
    throw new Error(
      "APP_EVENT_STREAM_TOKEN_MISSING: Backend did not return a valid event-stream token. Retry the request or reload the page."
    );
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/events?token=${encodeURIComponent(response.token)}`;
};

const apiWithJsonBody = async <T>(path: string, method: "POST" | "DELETE", body?: unknown): Promise<T> => {
  /* Reuse one JSON request helper so POST/DELETE keep identical auth and error handling. */
  const response = await assertOk(
    await fetch(path, {
      method,
      headers: {
        ...buildAuthHeaders(),
        "Content-Type": JSON_CONTENT_TYPE
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    })
  );

  return parseJsonResponse<T>(response);
};
