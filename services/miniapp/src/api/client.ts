/**
 * @fileoverview API client for backend requests.
 *
 * Exports:
 * - INIT_DATA_HEADER (L11) - Header name for Telegram initData.
 * - getInitData (L13) - Reads initData from Telegram WebApp.
 * - apiGet (L22) - GET helper with Telegram initData.
 * - apiPost (L35) - POST helper with Telegram initData.
 */

const INIT_DATA_HEADER = "x-telegram-init-data";
const STORAGE_KEY_WEB_TOKEN = "tvoc.miniapp.webToken";

const getInitData = (): string | undefined => {
  /* Read Telegram initData from WebApp context when available. */
  return (window as any)?.Telegram?.WebApp?.initData as string | undefined;
};

const readWebTokenFromLocation = (): string | null => {
  /*
   * Support opening Mini App in a regular browser.
   * Token may be passed via hash: #token=...
   */
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) {
    return null;
  }

  const params = new URLSearchParams(hash);
  const token = params.get("token");
  return token && token.trim().length > 0 ? token : null;
};

const getWebToken = (): string | undefined => {
  /* Read persisted token or capture it from URL hash. */
  const fromStorage = localStorage.getItem(STORAGE_KEY_WEB_TOKEN);
  if (fromStorage && fromStorage.trim().length > 0) {
    return fromStorage;
  }

  const fromHash = readWebTokenFromLocation();
  if (!fromHash) {
    return undefined;
  }

  localStorage.setItem(STORAGE_KEY_WEB_TOKEN, fromHash);
  return fromHash;
};

export const apiGet = async <T>(path: string): Promise<T> => {
  /* Perform authenticated GET request. */
  const initData = getInitData();
  const webToken = getWebToken();
  const headers: Record<string, string> = {};
  if (initData) {
    headers[INIT_DATA_HEADER] = initData;
  }
  if (webToken) {
    headers.Authorization = `Bearer ${webToken}`;
  }

  const response = await fetch(path, {
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as any;
      if (parsed && typeof parsed === "object" && typeof parsed.message === "string") {
        message = parsed.message;
      }
    } catch {
      // keep raw text
    }
    throw new Error(`Request failed: ${response.status}${message ? ` - ${message}` : ""}`);
  }

  const text = await response.text();
  if (!text.trim()) {
    return null as T;
  }
  return JSON.parse(text) as T;
};

export const apiPost = async <T>(path: string, body: unknown): Promise<T> => {
  /* Perform authenticated POST request. */
  const initData = getInitData();
  const webToken = getWebToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (initData) {
    headers[INIT_DATA_HEADER] = initData;
  }
  if (webToken) {
    headers.Authorization = `Bearer ${webToken}`;
  }

  const response = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as any;
      if (parsed && typeof parsed === "object" && typeof parsed.message === "string") {
        message = parsed.message;
      }
    } catch {
      // keep raw text
    }
    throw new Error(`Request failed: ${response.status}${message ? ` - ${message}` : ""}`);
  }

  const text = await response.text();
  if (!text.trim()) {
    return null as T;
  }
  return JSON.parse(text) as T;
};
