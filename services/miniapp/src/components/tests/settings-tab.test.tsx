/**
 * @fileoverview UI tests for SettingsTab controls.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsTab } from "../SettingsTab";

describe("SettingsTab", () => {
  afterEach(() => {
    /* Reset DOM between tests to keep queries deterministic. */
    cleanup();
  });

  it("calls refresh callback from settings action", () => {
    /* Project list refresh is intentionally moved from Projects tab to Settings tab. */
    const onRefreshProjects = vi.fn();
    render(
      <SettingsTab
        activeId={null}
        themeMode="light"
        overview={null}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={onRefreshProjects}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
      />
    );

    fireEvent.click(screen.getByText("8. Общие настройки"));
    fireEvent.click(screen.getByRole("button", { name: "Обновить список проектов" }));
    expect(onRefreshProjects).toHaveBeenCalledTimes(1);
  });
});
