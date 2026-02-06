/**
 * @fileoverview UI contract tests for ContainersTab controls.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContainersTab } from "../ContainersTab";

describe("ContainersTab", () => {
  afterEach(() => {
    /* Reset DOM between tests to keep role queries deterministic. */
    cleanup();
  });

  it("renders compose-wide lifecycle controls", () => {
    /* Operators need one-click control for whole compose project. */
    render(
      <ContainersTab
        activeId="tvoc"
        status={[]}
        logs={undefined}
        onRunComposeAction={vi.fn()}
        onRunContainerAction={vi.fn()}
        onLoadLogs={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Start All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restart All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop All" })).toBeTruthy();
  });

  it("calls per-container action handlers", () => {
    /* Every container row has explicit start/restart/stop controls. */
    const onRunContainerAction = vi.fn();
    render(
      <ContainersTab
        activeId="tvoc"
        status={[
          {
            name: "tvoc-backend-1",
            service: "backend",
            state: "running",
            ports: ["0.0.0.0:3000->3000"]
          }
        ]}
        logs={undefined}
        onRunComposeAction={vi.fn()}
        onRunContainerAction={onRunContainerAction}
        onLoadLogs={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart backend" }));
    expect(onRunContainerAction).toHaveBeenCalledWith("backend", "restart");
  });

  it("loads logs only from footer action", () => {
    /* Logs are moved under the container list, not project cards. */
    const onLoadLogs = vi.fn();
    render(
      <ContainersTab
        activeId="tvoc"
        status={[]}
        logs={undefined}
        onRunComposeAction={vi.fn()}
        onRunContainerAction={vi.fn()}
        onLoadLogs={onLoadLogs}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Load Logs" }));
    expect(onLoadLogs).toHaveBeenCalledTimes(1);
  });
});
