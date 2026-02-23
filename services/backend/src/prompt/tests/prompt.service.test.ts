/**
 * @fileoverview Tests for PromptService active-project guard messages.
 *
 * Key constructs:
 * - buildService (L20) - Creates PromptService with minimal test doubles.
 * - ACTIVE_PROJECT_REQUIRED_MESSAGE (L17) - Expected user-facing error text.
 * - describe("PromptService") (L49) - Verifies prompt/command flows fail with clear guidance.
 */

import { PromptService } from "../prompt.service";

const ACTIVE_PROJECT_REQUIRED_MESSAGE =
  "Проект не выбран. Выберите его командой /project <slug> (например: /project my-project) или в Mini App.";

const buildService = (): PromptService => {
  /* Keep doubles explicit so tests fail if guard execution path changes unexpectedly. */
  const opencode = {
    getDefaultModel: jest.fn(),
    sendPrompt: jest.fn(),
    executeCommand: jest.fn(),
    listCommands: jest.fn(),
    getModelContextLimit: jest.fn(),
    getModelDisplayName: jest.fn()
  };

  /* Project resolver returns null to simulate missing active project selection. */
  const projects = {
    getActiveProject: jest.fn().mockResolvedValue(null)
  };

  /* Other collaborators are not expected to run for guard-only scenarios. */
  const events = { publish: jest.fn() };
  const preferences = { getExecutionSettings: jest.fn() };
  const sessionRouting = { bind: jest.fn() };
  const opencodeEvents = { ensureDirectory: jest.fn() };

  return new PromptService(
    opencode as never,
    events as never,
    projects as never,
    preferences as never,
    sessionRouting as never,
    opencodeEvents as never
  );
};

describe("PromptService", () => {
  test("sendPrompt returns clear guidance when project is not selected", async () => {
    /* Users must get actionable instructions, including command format and Mini App fallback. */
    const service = buildService();

    await expect(service.sendPrompt("hello", 649624756)).rejects.toThrow(
      ACTIVE_PROJECT_REQUIRED_MESSAGE
    );
  });

  test("executeCommand returns same guidance when project is not selected", async () => {
    /* Keep error text consistent between prompt and slash-command entrypoints. */
    const service = buildService();

    await expect(
      service.executeCommand(
        {
          command: "status",
          arguments: []
        },
        649624756
      )
    ).rejects.toThrow(ACTIVE_PROJECT_REQUIRED_MESSAGE);
  });
});
