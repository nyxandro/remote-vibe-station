/**
 * @fileoverview Parser for `docker compose ps --format json` output.
 *
 * Exports:
 * - parseDockerComposePsOutput (L17) - Parses JSON array/object/NDJSON and skips warning lines.
 */

type JsonObject = Record<string, unknown>;

const JSON_OBJECT_START = "{";
const JSON_ARRAY_START = "[";

const isObject = (value: unknown): value is JsonObject => {
  /* Keep parser strict: we only accept plain JSON objects as rows. */
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

export const parseDockerComposePsOutput = (rawOutput: string, _projectSlug: string): JsonObject[] => {
  /* docker compose can emit array JSON, object JSON, or one JSON object per line. */
  const raw = rawOutput.trim();
  if (!raw) {
    return [];
  }

  /* Fast path: valid JSON payload without extra prefix lines. */
  if (raw.startsWith(JSON_ARRAY_START) || raw.startsWith(JSON_OBJECT_START)) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(isObject);
      }
      if (isObject(parsed)) {
        return [parsed];
      }
    } catch {
      // Fallback to line-by-line parsing to handle mixed output with warnings.
    }
  }

  /* Fallback path: parse NDJSON rows and skip non-JSON warnings/noise lines. */
  const rows: JsonObject[] = [];
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith(JSON_OBJECT_START) && !line.startsWith(JSON_ARRAY_START)) {
      continue;
    }

    try {
      const parsedLine = JSON.parse(line) as unknown;
      if (Array.isArray(parsedLine)) {
        rows.push(...parsedLine.filter(isObject));
        continue;
      }
      if (isObject(parsedLine)) {
        rows.push(parsedLine);
      }
    } catch {
      // Ignore malformed lines and keep scanning for valid JSON objects.
    }
  }

  if (rows.length > 0) {
    return rows;
  }

  /*
   * Some Docker Compose builds ignore `--format json` and print a table.
   * For UI status screens we prefer a stable empty list over a hard failure.
   */
  return [];
};
