// @vitest-environment jsdom

/**
 * @fileoverview Tests for Mini App tab persistence helpers.
 *
 * Exports:
 * - (none)
 */

import { afterEach, describe, expect, it } from "vitest";

import { persistTabSelection, readTabPersistenceState } from "../use-tab-memory";

describe("tab memory", () => {
  afterEach(() => {
    /* Reset storage between tests to keep expectations deterministic. */
    localStorage.clear();
  });

  it("restores defaults when nothing was saved", () => {
    expect(readTabPersistenceState()).toEqual({
      activeTab: "projects",
      lastWorkspaceTab: "files"
    });
  });

  it("stores workspace tab as lastWorkspaceTab", () => {
    persistTabSelection("providers");

    expect(readTabPersistenceState()).toEqual({
      activeTab: "providers",
      lastWorkspaceTab: "providers"
    });
  });

  it("stores proxy tab independently from providers", () => {
    /* Proxy section should persist as separate workspace tab without rewriting provider tab state. */
    persistTabSelection("proxy");

    expect(readTabPersistenceState()).toEqual({
      activeTab: "proxy",
      lastWorkspaceTab: "proxy"
    });
  });

  it("does not overwrite lastWorkspaceTab when selecting projects", () => {
    persistTabSelection("terminal");
    persistTabSelection("projects");

    expect(readTabPersistenceState()).toEqual({
      activeTab: "projects",
      lastWorkspaceTab: "terminal"
    });
  });
});
