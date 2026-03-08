/**
 * @fileoverview Tests for PromptService guard rails and multipart dispatch behavior.
 *
 * Key constructs:
 * - buildGuardOnlyService (L18) - Creates PromptService focused on missing-project checks.
 * - createDispatchHarness (L50) - Builds explicit doubles for multipart dispatch scenarios.
 * - describe("PromptService", L110) - Covers guidance errors and empty multipart fallback.
 */

import { PromptService } from "../prompt.service";

const ACTIVE_PROJECT_REQUIRED_MESSAGE =
  "Проект не выбран. Выберите его командой /project <slug> (например: /project my-project) или в Mini App.";

const buildGuardOnlyService = (): PromptService => {
  /* Keep doubles explicit so tests fail if guard execution path changes unexpectedly. */
  const opencode = {
    getDefaultModel: jest.fn(),
    sendPrompt: jest.fn(),
    sendPromptParts: jest.fn(),
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
  const opencodeEvents = { ensureDirectory: jest.fn(), waitUntilConnected: jest.fn() };

  return new PromptService(
    opencode as never,
    events as never,
    projects as never,
    preferences as never,
    sessionRouting as never,
    opencodeEvents as never
  );
};

const createDispatchHarness = () => {
  /* Queue-specific fallback tests need full collaborator doubles and call assertions. */
  const opencode = {
    getDefaultModel: jest.fn().mockResolvedValue({ providerID: "cliproxy", modelID: "gpt-5" }),
    sendPrompt: jest.fn(),
    sendPromptParts: jest.fn(),
    executeCommand: jest.fn(),
    listCommands: jest.fn(),
    getModelContextLimit: jest.fn(),
    getModelDisplayName: jest.fn()
  };
  const events = { publish: jest.fn() };
  const projects = { getActiveProject: jest.fn() };
  const preferences = {
    getExecutionSettings: jest.fn().mockResolvedValue({
      model: { providerID: "cliproxy", modelID: "gpt-5", variant: "high" },
      agent: "build"
    })
  };
  const sessionRouting = { bind: jest.fn() };
  const opencodeEvents = {
    ensureDirectory: jest.fn(),
    waitUntilConnected: jest.fn().mockResolvedValue(undefined),
    watchPermissionOnce: jest.fn()
  };

  const service = new PromptService(
    opencode as never,
    events as never,
    projects as never,
    preferences as never,
    sessionRouting as never,
    opencodeEvents as never
  );

  return {
    service,
    opencode,
    events,
    projects,
    preferences,
    sessionRouting,
    opencodeEvents
  };
};

describe("PromptService", () => {
  test("sendPrompt returns clear guidance when project is not selected", async () => {
    /* Users must get actionable instructions, including command format and Mini App fallback. */
    const service = buildGuardOnlyService();

    await expect(service.sendPrompt("hello", 649624756)).rejects.toThrow(
      ACTIVE_PROJECT_REQUIRED_MESSAGE
    );
  });

  test("executeCommand returns same guidance when project is not selected", async () => {
    /* Keep error text consistent between prompt and slash-command entrypoints. */
    const service = buildGuardOnlyService();

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

  test("dispatchPromptParts allows empty multipart response for queued image prompts", async () => {
    /* Telegram image queue should not fail when final answer is delivered only through runtime events. */
    const harness = createDispatchHarness();
    harness.opencode.sendPromptParts.mockResolvedValue({
      sessionId: "session-empty",
      responseText: "",
      emptyResponse: true,
      info: {
        providerID: "cliproxy",
        modelID: "gpt-5",
        mode: "primary",
        agent: "build",
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
      },
      parts: []
    });

    const result = await harness.service.dispatchPromptParts({
      adminId: 7,
      projectSlug: "demo",
      directory: "/tmp/demo",
      promptTextForTelemetry: "",
      parts: [
        {
          type: "file",
          mime: "image/png",
          url: "file:///root/.local/share/opencode/telegram-prompt-attachments/demo.png",
          filename: "demo.png"
        }
      ],
      allowEmptyResponse: true
    });

    expect(result).toEqual({
      sessionId: "session-empty",
      responseText: "",
      model: { providerID: "cliproxy", modelID: "gpt-5" },
      mode: "primary",
      agent: "build",
      tokens: { input: 0, output: 0, reasoning: 0 }
    });
    expect(harness.events.publish).toHaveBeenCalledTimes(1);
    expect(harness.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "opencode.prompt" })
    );
  });

  test("dispatchPromptParts publishes auto session start event when OpenCode creates a new session implicitly", async () => {
    /* Telegram must warn when a prompt silently lands in a fresh thread instead of the previous session. */
    const harness = createDispatchHarness();
    harness.opencode.getModelContextLimit.mockResolvedValue(null);
    harness.opencode.getModelDisplayName.mockResolvedValue(null);
    harness.opencode.sendPromptParts.mockImplementation(
      async (
        _parts: unknown,
        options: {
          onSessionResolved?: (sessionID: string, resolution: { isNew: boolean; reason: string }) => void;
        }
      ) => {
        options.onSessionResolved?.("session-auto", { isNew: true, reason: "busy-rotated" });
        return {
          sessionId: "session-auto",
          responseText: "Готово",
          info: {
            providerID: "cliproxy",
            modelID: "gpt-5",
            mode: "primary",
            agent: "build",
            tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }
          },
          parts: [{ type: "text", text: "Готово" }]
        };
      }
    );

    const result = await harness.service.dispatchPromptParts({
      adminId: 7,
      projectSlug: "carousel",
      directory: "/tmp/carousel",
      promptTextForTelemetry: "hello",
      parts: [{ type: "text", text: "hello" }]
    });

    expect(result.responseText).toBe("Готово");
    expect(harness.events.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "opencode.session.started",
        data: expect.objectContaining({
          adminId: 7,
          projectSlug: "carousel",
          trigger: "busy-rotated",
          sessionId: "session-auto"
        })
      })
    );
  });

  test("dispatchPromptParts publishes final assistant text block separately from full text transcript", async () => {
    /* Telegram should keep streamed intermediate updates separate and only replace the last live message with the real final block. */
    const harness = createDispatchHarness();
    harness.opencode.getModelContextLimit.mockResolvedValue(null);
    harness.opencode.getModelDisplayName.mockResolvedValue(null);
    harness.opencode.sendPromptParts.mockResolvedValue({
      sessionId: "session-final-block",
      responseText: "Понял задачу.Сейчас проверю compose.Нашел проблему и исправил.",
      info: {
        providerID: "cliproxy",
        modelID: "gpt-5",
        mode: "primary",
        agent: "build",
        tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }
      },
      parts: [
        { type: "text", text: "Понял задачу." },
        { type: "tool", tool: "bash", state: "completed" },
        { type: "text", text: "Сейчас проверю compose." },
        { type: "tool", tool: "bash", state: "completed" },
        { type: "text", text: "Нашел проблему и исправил." }
      ]
    });

    await harness.service.dispatchPromptParts({
      adminId: 7,
      projectSlug: "demo",
      directory: "/tmp/demo",
      promptTextForTelemetry: "fix compose",
      parts: [{ type: "text", text: "fix compose" }]
    });

    expect(harness.events.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "opencode.message",
        data: expect.objectContaining({
          text: "Понял задачу.Сейчас проверю compose.Нашел проблему и исправил.",
          finalText: "Нашел проблему и исправил."
        })
      })
    );
  });
});
