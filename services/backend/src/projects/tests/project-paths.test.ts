/**
 * @fileoverview Tests for project path validation.
 *
 * Exports:
 * - (none)
 *
 * Tests:
 * - assertWithinRoot suite (L10) - Root containment cases.
 */

import { assertWithinRoot } from "../project-paths";

describe("assertWithinRoot", () => {
  it("allows path inside root", () => {
    /* Should not throw for child paths. */
    expect(() => assertWithinRoot("/srv/projects", "/srv/projects/app"))
      .not.toThrow();
  });

  it("allows root itself", () => {
    /* Should allow root path. */
    expect(() => assertWithinRoot("/srv/projects", "/srv/projects")).not.toThrow();
  });

  it("rejects path outside root", () => {
    /* Should throw for traversal outside root. */
    expect(() => assertWithinRoot("/srv/projects", "/etc")).toThrow();
  });
});
