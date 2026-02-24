/**
 * @fileoverview Tests for active session fetch/format helpers.
 *
 * Exports:
 * - (none)
 */

import { fetchActiveSessionTitle, formatActiveSessionLine } from "../active-session";

describe("active-session helpers", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test("returns trimmed active session title from sessions payload", async () => {
    /* Bot should show readable active session title for operator context. */
    const fetchMock = jest.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessions: [
          { title: " Old one ", active: false },
          { title: " Sprint plan ", active: true }
        ]
      })
    } as Response);

    const title = await fetchActiveSessionTitle("http://backend:3000", 42);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend:3000/api/telegram/sessions",
      expect.objectContaining({
        headers: { "x-admin-id": "42" },
        signal: expect.any(Object)
      })
    );
    expect(title).toBe("Sprint plan");
  });

  test("returns null when no active session in payload", async () => {
    /* Missing active marker should render as no selected session. */
    jest.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessions: [{ title: "Draft", active: false }]
      })
    } as Response);

    const title = await fetchActiveSessionTitle("http://backend:3000", 42);
    expect(title).toBeNull();
  });

  test("throws explicit error when backend returns ok=false", async () => {
    /* Payload-level failure should not be treated as empty sessions list. */
    jest.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        sessions: []
      })
    } as Response);

    await expect(fetchActiveSessionTitle("http://backend:3000", 42)).rejects.toThrow(
      "Failed to load sessions: backend returned ok=false"
    );
  });

  test("throws timeout error when sessions request is aborted", async () => {
    /* Timeout path should return actionable context for operator diagnostics. */
    const abortError = new Error("aborted");
    (abortError as { name?: string }).name = "AbortError";
    jest.spyOn(globalThis, "fetch" as any).mockRejectedValue(abortError);

    await expect(fetchActiveSessionTitle("http://backend:3000", 42)).rejects.toThrow(
      "request timed out"
    );
  });

  test("formats active session line with fallback label", () => {
    /* UI-only fallback keeps message explicit when session is missing. */
    expect(formatActiveSessionLine("Session A")).toBe("Текущая сессия: Session A");
    expect(formatActiveSessionLine(null)).toBe("Текущая сессия: не выбрана");
  });
});
