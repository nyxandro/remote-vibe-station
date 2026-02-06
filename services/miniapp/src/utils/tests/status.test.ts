/**
 * @fileoverview Tests for status formatting utilities.
 *
 * Exports:
 * - (none)
 *
 * Tests:
 * - formatProjectStatus suite (L12) - Label formatting cases.
 */

import { describe, expect, it } from "vitest";

import { formatProjectStatus } from "../status";

describe("formatProjectStatus", () => {
  it("returns Active for running", () => {
    /* Ensure running status is normalized. */
    expect(formatProjectStatus("running")).toBe("Active");
  });

  it("returns Stopped for stopped", () => {
    /* Ensure stopped status is normalized. */
    expect(formatProjectStatus("stopped")).toBe("Stopped");
  });

  it("returns Unknown for others", () => {
    /* Ensure unknown status is handled. */
    expect(formatProjectStatus("unknown")).toBe("Unknown");
  });
});
