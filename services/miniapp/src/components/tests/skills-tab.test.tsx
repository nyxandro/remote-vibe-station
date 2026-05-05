/**
 * @fileoverview UI tests for SkillsTab — focuses on client-side pagination behavior.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillsTab } from "../SkillsTab";
import { NeuralDeepSkillCatalogItem } from "../../types";

/* Build a deterministic catalog of N skill rows for paging assertions. */
const buildCatalog = (count: number): NeuralDeepSkillCatalogItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
    name: `skill-${index}`,
    owner: null,
    repo: null,
    description: null,
    installs: null,
    trending24h: null,
    category: null,
    tags: [],
    featured: false,
    githubStars: null,
    type: null,
    installed: false
  }));

const renderTab = (catalog: NeuralDeepSkillCatalogItem[]) =>
  render(
    <SkillsTab
      catalog={catalog}
      installedSkills={[]}
      isLoading={false}
      mutatingSkillName={null}
      mutatingKind={null}
      mutationStartedAt={null}
      mutationStatus={null}
      onSearch={vi.fn()}
      onInstall={vi.fn()}
      onUninstall={vi.fn()}
      onDismissStatus={vi.fn()}
    />
  );

describe("SkillsTab pagination", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders only first 20 items by default and shows load-more for the rest", () => {
    /* Catalog of 46 mirrors today's NeuralDeep size — first page is exactly 20. */
    renderTab(buildCatalog(46));
    expect(screen.queryByRole("heading", { name: "skill-19" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "skill-20" })).toBeNull();
    expect(screen.getByRole("button", { name: /Загрузить ещё/ })).not.toBeNull();
  });

  it("expands by 20 on each click and hides the button when exhausted", () => {
    renderTab(buildCatalog(46));
    /* First click: 20 → 40, button still present (6 left). */
    fireEvent.click(screen.getByRole("button", { name: /Загрузить ещё/ }));
    expect(screen.queryByRole("heading", { name: "skill-39" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "skill-40" })).toBeNull();
    /* Second click: 40 → 60, all 46 visible, button hidden. */
    fireEvent.click(screen.getByRole("button", { name: /Загрузить ещё/ }));
    expect(screen.queryByRole("heading", { name: "skill-45" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Загрузить ещё/ })).toBeNull();
  });

  it("does not render load-more when total fits within one page", () => {
    renderTab(buildCatalog(15));
    expect(screen.queryByRole("button", { name: /Загрузить ещё/ })).toBeNull();
  });
});
