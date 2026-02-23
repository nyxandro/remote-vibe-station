/**
 * @fileoverview Tests for Telegram start summary message formatting.
 *
 * Exports:
 * - (none)
 */

import { buildStartSummaryMessage } from "../start-summary";

describe("buildStartSummaryMessage", () => {
  test("renders informative sections for project git mode and commands", () => {
    /* Keep operator-facing start message compact but data-rich. */
    const text = buildStartSummaryMessage({
      project: {
        slug: "remote-vibe-station",
        rootPath: "/home/nyx/projects/remote-vibe-station"
      },
      git: {
        filesChanged: 4,
        additions: 33,
        deletions: 12
      },
      mode: {
        providerID: "opencode",
        modelID: "gpt-5-nano",
        thinking: "medium",
        agent: "build"
      },
      commands: [
        { command: "open", description: "Открыть Mini App" },
        { command: "mode", description: "Настроить model/agent" }
      ]
    });

    expect(text).toContain("Привет!");
    expect(text).toContain("Текущий проект: remote-vibe-station");
    expect(text).toContain("Незакоммиченные изменения: 4 файлов (+33/-12)");
    expect(text).toContain("Режим: model=opencode/gpt-5-nano, agent=build, thinking=medium");
    expect(text).toContain("/open - Открыть Mini App");
    expect(text).toContain("/mode - Настроить model/agent");
  });

  test("handles empty project and command list", () => {
    /* Fallback text must stay explicit when project or commands are unavailable. */
    const text = buildStartSummaryMessage({
      project: null,
      git: null,
      mode: {
        providerID: "opencode",
        modelID: "big-pickle",
        thinking: null,
        agent: null
      },
      commands: []
    });

    expect(text).toContain("Текущий проект: не выбран");
    expect(text).toContain("Незакоммиченные изменения: нет данных (проект не выбран)");
    expect(text).toContain("Режим: model=opencode/big-pickle, agent=build (default), thinking=default");
    expect(text).toContain("Доступные команды: нет");
  });
});
