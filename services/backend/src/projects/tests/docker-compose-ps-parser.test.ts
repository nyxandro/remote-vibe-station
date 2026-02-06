/**
 * @fileoverview Tests for docker compose ps JSON parsing.
 *
 * Exports:
 * - (none)
 */

import { parseDockerComposePsOutput } from "../docker-compose-ps-parser";

describe("parseDockerComposePsOutput", () => {
  test("parses newline-delimited JSON objects returned by docker compose", () => {
    /* Compose can return one JSON object per line instead of a JSON array. */
    const raw = [
      '{"Name":"web","State":"running","Publishers":[{"PublishedPort":80}]}',
      '{"Name":"db","State":"running","Publishers":[]}'
    ].join("\n");

    const parsed = parseDockerComposePsOutput(raw, "tvoc");
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  test("ignores non-JSON warning lines and still parses JSON payload", () => {
    /* Some environments prepend warnings before the JSON payload. */
    const raw = [
      "time=\"2026-02-06T09:01:53+03:00\" level=warning msg=\"attribute version is obsolete\"",
      '{"Name":"api","State":"running","Publishers":[]}'
    ].join("\n");

    const parsed = parseDockerComposePsOutput(raw, "tvoc");
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ Name: "api" });
  });

  test("returns empty list when compose outputs legacy table format", () => {
    /* Old compose versions may ignore --format json and print a table. */
    const raw = [
      "NAME              IMAGE     COMMAND   SERVICE   CREATED         STATUS         PORTS",
      "tvoc-backend-1    app:dev   \"npm\"   backend   2 minutes ago   Up 2 minutes   0.0.0.0:3000->3000/tcp"
    ].join("\n");

    const parsed = parseDockerComposePsOutput(raw, "tvoc");
    expect(parsed).toEqual([]);
  });
});
