/**
 * @fileoverview Tests for project container health aggregation.
 */

import { describe, expect, it } from "vitest";

import { deriveProjectContainerHealth } from "../project-container-health";

describe("deriveProjectContainerHealth", () => {
  it("returns null when status rows are missing", () => {
    /* Compose not running should not show any badge in project cards. */
    expect(deriveProjectContainerHealth(undefined)).toBeNull();
    expect(deriveProjectContainerHealth([])).toBeNull();
  });

  it("returns compact total when all containers are running", () => {
    /* Healthy compose should show plain total without slash. */
    const health = deriveProjectContainerHealth([
      { name: "a", service: "a", state: "running" },
      { name: "b", service: "b", state: "Up 3 minutes" }
    ]);

    expect(health).toMatchObject({ countLabel: "2", level: "healthy" });
  });

  it("returns fraction when only part of containers are running", () => {
    /* Partial health should expose running/total fraction. */
    const health = deriveProjectContainerHealth([
      { name: "a", service: "a", state: "running" },
      { name: "b", service: "b", state: "exited" },
      { name: "c", service: "c", state: "created" }
    ]);

    expect(health).toMatchObject({ countLabel: "1/3", level: "partial" });
  });
});
