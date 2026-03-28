/**
 * @fileoverview UI tests for runtime service health dashboard cards and modal actions.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceHealthDashboard } from "../ServiceHealthDashboard";
import { ServiceHealthModal } from "../ServiceHealthModal";
import { RuntimeServicesSnapshot } from "../../types";

const buildSnapshot = (): RuntimeServicesSnapshot => ({
  capturedAt: "2026-03-28T12:00:00.000Z",
  services: [
    {
      id: "miniapp",
      label: "Mini App",
      composeService: "miniapp",
      containerName: "remote-vibe-station-miniapp-1",
      containerStatus: "running",
      health: "healthy",
      healthcheckStatus: null,
      startedAt: "2026-03-28T11:55:00.000Z",
      uptimeSeconds: 300,
      probeUrl: "http://miniapp:4173/",
      probe: { ok: true, statusCode: 200, latencyMs: 32, errorCode: null },
      message: "Service is responding normally.",
      actions: { canRestart: true }
    },
    {
      id: "bot",
      label: "Telegram Bot",
      composeService: "bot",
      containerName: "remote-vibe-station-bot-1",
      containerStatus: "running",
      health: "degraded",
      healthcheckStatus: null,
      startedAt: "2026-03-28T11:50:00.000Z",
      uptimeSeconds: 600,
      probeUrl: "http://bot:3001/",
      probe: { ok: false, statusCode: 502, latencyMs: 210, errorCode: null },
      message: "Service is running, but the live probe failed: HTTP 502.",
      actions: { canRestart: true }
    },
    {
      id: "opencode",
      label: "OpenCode",
      composeService: "opencode",
      containerName: "remote-vibe-station-opencode-1",
      containerStatus: "running",
      health: "healthy",
      healthcheckStatus: null,
      startedAt: "2026-03-28T11:40:00.000Z",
      uptimeSeconds: 1200,
      probeUrl: "http://opencode:4096/",
      probe: { ok: true, statusCode: 200, latencyMs: 41, errorCode: null },
      message: "Service is responding normally.",
      actions: { canRestart: true }
    },
    {
      id: "cliproxy",
      label: "CLIProxy",
      composeService: "cliproxy",
      containerName: "remote-vibe-station-cliproxy-1",
      containerStatus: "running",
      health: "down",
      healthcheckStatus: "unhealthy",
      startedAt: "2026-03-28T11:30:00.000Z",
      uptimeSeconds: 1800,
      probeUrl: "http://cliproxy:8317/v1/models",
      probe: { ok: false, statusCode: null, latencyMs: 4000, errorCode: "AbortError" },
      message: "Docker healthcheck is failing.",
      actions: { canRestart: true }
    }
  ]
});

describe("ServiceHealthDashboard", () => {
  afterEach(() => {
    /* Reset DOM between tests so modal/card queries remain deterministic. */
    cleanup();
  });

  it("renders service cards and opens details callback", () => {
    /* Dashboard should surface four critical runtime services with compact status labels. */
    const onSelectService = vi.fn();
    render(
      <ServiceHealthDashboard
        snapshot={buildSnapshot()}
        isLoading={false}
        restartingByService={{}}
        onReload={vi.fn()}
        onSelectService={onSelectService}
      />
    );

    expect(screen.getByText("Service health")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mini App/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Telegram Bot/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /OpenCode/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /CLIProxy/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /CLIProxy/i }));
    expect(onSelectService).toHaveBeenCalledWith(buildSnapshot().services[3]);
  });
});

describe("ServiceHealthModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows service details and restart action state", () => {
    /* Service modal should expose uptime, diagnostics and restart control for operators. */
    const onRestart = vi.fn();
    render(
      <ServiceHealthModal
        service={buildSnapshot().services[2]}
        canRestart={true}
        isRestarting={true}
        onClose={vi.fn()}
        onRestart={onRestart}
      >
        <div>OpenCode config body</div>
      </ServiceHealthModal>
    );

    expect(screen.getByText("OpenCode")).toBeTruthy();
    expect(screen.getByText("Service is responding normally.")).toBeTruthy();
    expect(screen.getByText("OpenCode config body")).toBeTruthy();
    expect(screen.getByText("Uptime")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Restarting..." }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Restarting..." }));
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("hides restart action for self-hosted control surfaces", () => {
    /* Mini App should not offer self-disrupting restart controls from inside the same UI. */
    render(
      <ServiceHealthModal
        service={buildSnapshot().services[0]}
        canRestart={false}
        isRestarting={false}
        onClose={vi.fn()}
        onRestart={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Restart service" })).toBeNull();
    expect(screen.getByText("Restart is intentionally unavailable from Mini App for this service.")).toBeTruthy();
  });
});
