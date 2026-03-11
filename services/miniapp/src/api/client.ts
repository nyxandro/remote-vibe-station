/**
 * @fileoverview API client for backend requests.
 *
 * Exports:
 * - apiGet - Authenticated GET helper that parses JSON responses.
 * - apiPost - Authenticated JSON POST helper.
 * - apiPostFormData - Authenticated multipart POST helper for file uploads.
 * - apiDelete - Authenticated DELETE helper.
 * - apiDownload - Authenticated GET helper that returns a Blob for browser downloads.
 */

const INIT_DATA_HEADER = "x-telegram-init-data";
const STORAGE_KEY_WEB_TOKEN = "tvoc.miniapp.webToken";
const AUTHORIZATION_HEADER = "Authorization";
const JSON_CONTENT_TYPE = "application/json";

const getInitData = (): string | undefined => {
  /* Read Telegram initData from WebApp context when available. */
  return (window as any)?.Telegram?.WebApp?.initData as string | undefined;
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

  sessionStorage.setItem(STORAGE_KEY_WEB_TOKEN, fromHash);
  window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  return fromHash;
};

const buildAuthHeaders = (): Record<string, string> => {
  /* Every Mini App request shares the same Telegram/browser auth header resolution. */
  const initData = getInitData();
  const webToken = getWebToken();
  const headers: Record<string, string> = {};

  if (initData) {
    headers[INIT_DATA_HEADER] = initData;
  }

  if (webToken) {
    headers[AUTHORIZATION_HEADER] = `Bearer ${webToken}`;
  }

  return headers;
};

const buildErrorMessage = async (response: Response): Promise<string> => {
  /* Prefer backend-provided JSON message but keep raw body for non-JSON failures. */
  const text = await response.text();
  let message = text;

  try {
    const parsed = JSON.parse(text) as { message?: string } | null;
    if (parsed && typeof parsed === "object" && typeof parsed.message === "string") {
      message = parsed.message;
    }
  } catch {
    // Keep raw response text when body is not JSON.
  }

  return `Request failed: ${response.status}${message ? ` - ${message}` : ""}`;
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

export const apiDelete = async <T>(path: string): Promise<T> => {
  /* Perform authenticated DELETE request. */
  return apiWithJsonBody<T>(path, "DELETE");
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
