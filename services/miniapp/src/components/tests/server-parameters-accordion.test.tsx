/**
 * @fileoverview UI tests for server metrics accordion in Settings tab.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerParametersAccordion } from "../ServerParametersAccordion";

describe("ServerParametersAccordion", () => {
  afterEach(() => {
    /* Reset DOM between tests to keep role-based queries deterministic. */
    cleanup();
  });

  it("renders server metrics and triggers reload action", () => {
    /* Server health block should expose key CPU/RAM/Disk/Network numbers in one place. */
    const onReload = vi.fn();

    render(
      <ServerParametersAccordion
        metrics={{
          capturedAt: "2026-03-06T10:20:00.000Z",
          cpu: { cores: 8, load1: 0.72, load5: 0.61, load15: 0.49 },
          memory: {
            totalBytes: 17179869184,
            freeBytes: 4294967296,
            usedBytes: 12884901888,
            freePercent: 25,
            usedPercent: 75
          },
          disk: {
            rootPath: "/srv/projects",
            totalBytes: 536870912000,
            freeBytes: 107374182400,
            usedBytes: 429496729600,
            freePercent: 20,
            usedPercent: 80
          },
          network: {
            interfaces: 2,
            rxBytes: 123456789,
            txBytes: 987654321
          }
        }}
        isLoading={false}
        onReload={onReload}
      />
    );

    fireEvent.click(screen.getByText("9. Параметры сервера"));
    expect(screen.getByText("8 cores")).toBeTruthy();
    expect(screen.getAllByText("Свободно:").length).toBe(2);
    expect(screen.getByText("4.00 GB")).toBeTruthy();
    expect(screen.getByText("100.00 GB")).toBeTruthy();
    expect(screen.getByText("117.74 MB")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Обновить метрики" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
