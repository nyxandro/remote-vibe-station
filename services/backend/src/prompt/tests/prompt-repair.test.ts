/**
 * @fileoverview Tests for manual /repair recovery flow in PromptService.
 *
 * Exports:
 * - (none)
 */

import { PromptService } from "../prompt.service";

describe("PromptService.repair", () => {
  const buildService = (activeProject: { slug: string; rootPath: string } | null) => {
    /* Keep collaborators explicit to verify recovery orchestration contract. */
    const opencode = {
      getDefaultModel: jest.fn(),
      sendPrompt: jest.fn(),
      executeCommand: jest.fn(),
      listCommands: jest.fn(),
      getModelContextLimit: jest.fn(),
      getModelDisplayName: jest.fn(),
      repairStuckSessions: jest.fn().mockResolvedValue({ scanned: 2, busy: 1, aborted: ["ses-1"] })
    };

    const projects = {
      getActiveProject: jest.fn().mockResolvedValue(activeProject)
    };

    const events = { publish: jest.fn() };
    const preferences = { getExecutionSettings: jest.fn() };
    const sessionRouting = { bind: jest.fn() };
    const opencodeEvents = {
      ensureDirectory: jest.fn(),
      waitUntilConnected: jest.fn().mockResolvedValue(undefined)
    };

    const service = new PromptService(
      opencode as never,
      events as never,
      projects as never,
      preferences as never,
      sessionRouting as never,
      opencodeEvents as never
    );

    return { service, opencode, projects, opencodeEvents };
  };

  it("aborts stale busy sessions in active project context", async () => {
    /* /repair must run in selected project to avoid global-state recovery mistakes. */
    const { service, opencode, opencodeEvents } = buildService({
      slug: "arena",
      rootPath: "/home/nyx/projects/arena"
    });

    const result = await service.repair(649624756);

    expect(opencodeEvents.ensureDirectory).toHaveBeenCalledWith("/home/nyx/projects/arena");
    expect(opencodeEvents.waitUntilConnected).toHaveBeenCalledWith("/home/nyx/projects/arena");
    expect(opencode.repairStuckSessions).toHaveBeenCalledWith({
      directory: "/home/nyx/projects/arena",
      busyTimeoutMs: 45_000
    });
    expect(result).toEqual({
      projectSlug: "arena",
      directory: "/home/nyx/projects/arena",
      busyTimeoutMs: 45_000,
      scanned: 2,
      busy: 1,
      aborted: ["ses-1"]
    });
  });

  it("fails with actionable guidance when no active project selected", async () => {
    /* Repair command should not run against OpenCode global workspace by accident. */
    const { service } = buildService(null);

    await expect(service.repair(649624756)).rejects.toThrow("Проект не выбран");
  });
});
