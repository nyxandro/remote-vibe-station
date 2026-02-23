/**
 * @fileoverview Tests for backend HTTP error message normalization.
 *
 * Key constructs:
 * - buildBackendErrorMessage (L11) - Converts backend status/body into human-readable text.
 * - describe("buildBackendErrorMessage") (L13) - Covers JSON and plain-text error payloads.
 */

import { buildBackendErrorMessage } from "../backend-error";

describe("buildBackendErrorMessage", () => {
  test("uses backend JSON message when available", () => {
    /* Prefer API-provided explanation over generic transport details. */
    const text = buildBackendErrorMessage(400, {
      statusCode: 400,
      message:
        "Проект не выбран. Выберите его командой /project <slug> (например: /project my-project) или в Mini App."
    });

    expect(text).toBe(
      "Проект не выбран. Выберите его командой /project <slug> (например: /project my-project) или в Mini App."
    );
  });

  test("falls back to concise status text for malformed payload", () => {
    /* Keep operator output readable when backend body is not JSON. */
    expect(buildBackendErrorMessage(502, "<html>Bad Gateway</html>")).toBe("Ошибка backend (502)");
  });
});
