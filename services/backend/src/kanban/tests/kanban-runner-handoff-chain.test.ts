/**
 * @fileoverview Integration-style regression test for the full kanban runner handoff chain.
 *
 * Exports:
 * - none (Jest suite).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { EventsService } from "../../events/events.service";
import { TelegramStreamStore } from "../../telegram/telegram-stream.store";
import { TelegramEventsOutboxBridge } from "../../telegram/outbox/telegram-events-outbox-bridge.service";
import { TelegramOutboxController } from "../../telegram/outbox/telegram-outbox.controller";
import { TelegramOutboxService } from "../../telegram/outbox/telegram-outbox.service";
import { TelegramOutboxStore } from "../../telegram/outbox/telegram-outbox.store";
import { KanbanRunnerHandoffService } from "../kanban-runner-handoff.service";
import { KanbanRunnerHandoffStore } from "../kanban-runner-handoff.store";
import { KanbanRunnerService, KANBAN_RUNNER_AGENT_ID } from "../kanban-runner.service";

const buildTask = (overrides?: Record<string, unknown>) => ({
  id: "task-1",
  projectSlug: "alpha",
  projectName: "Alpha",
  title: "Integration handoff",
  description: "Keep task starts ordered behind Telegram delivery.",
  status: "in_progress",
  priority: "high",
  acceptanceCriteria: [{ id: "criterion-1", text: "Done", status: "pending" }],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-10T09:00:00.000Z",
  updatedAt: "2026-03-10T09:00:00.000Z",
  claimedBy: KANBAN_RUNNER_AGENT_ID,
  leaseUntil: "2026-03-10T12:00:00.000Z",
  executionSource: "runner",
  executionSessionId: "session-runner",
  ...overrides
});

const waitFor = async (assertion: () => void | Promise<void>): Promise<void> => {
  /* Event-driven follow-ups happen asynchronously, so poll briefly for the expected side effect. */
  const timeoutAt = Date.now() + 1_000;
  let lastError: unknown;

  while (Date.now() < timeoutAt) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for handoff chain");
};

describe("Kanban runner handoff chain", () => {
  test("starts the next queued task only after the final Telegram reply is delivered", async () => {
    /* This regression guards the exact bug where "взял в работу" could outrun the previous final answer. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-kanban-handoff-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      const config = {
        kanbanRunnerEnabled: true,
        adminIds: [1],
        telegramBotToken: "x",
        publicBaseUrl: "http://localhost:4173",
        publicDomain: "localhost",
        projectsRoot: tmp,
        opencodeServerUrl: "http://localhost",
        eventBufferSize: 100
      };

      const blockedTask = buildTask({
        id: "task-blocked",
        status: "blocked",
        claimedBy: null,
        leaseUntil: null,
        executionSource: null,
        executionSessionId: null,
        blockedReason: "Need dependency"
      });
      const queuedTask = buildTask({
        id: "task-queued",
        title: "Next task",
        status: "queued",
        claimedBy: null,
        leaseUntil: null,
        executionSource: null,
        executionSessionId: null
      });
      const claimedTask = buildTask({
        id: "task-queued",
        title: "Next task",
        status: "in_progress",
        claimedBy: KANBAN_RUNNER_AGENT_ID,
        executionSource: "runner",
        executionSessionId: "session-next"
      });
      const doneTask = buildTask({
        id: "task-queued",
        title: "Next task",
        status: "done",
        claimedBy: null,
        leaseUntil: null,
        executionSource: null,
        executionSessionId: null,
        resultSummary: "done"
      });

      let projectTasks: Array<ReturnType<typeof buildTask>> = [blockedTask, queuedTask];
      const kanban = {
        listTasks: jest.fn(async () => projectTasks),
        startTaskExecution: jest.fn(async () => {
          projectTasks = [blockedTask, claimedTask];
          return claimedTask;
        })
      };
      const runnerSessions = {
        getTaskSessionId: jest.fn(async () => null),
        setTaskSessionId: jest.fn(async () => undefined)
      };
      const projects = {
        getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
      };
      const opencode = {
        createDetachedSession: jest.fn(async () => ({ id: "session-next" })),
        rememberSelectedSession: jest.fn(),
        getModelContextLimit: jest.fn(async () => null),
        getModelDisplayName: jest.fn(async () => null),
        sendPromptToSession: jest.fn(async () => {
          projectTasks = [blockedTask, doneTask];
          return {
            sessionId: "session-next",
            responseText: "Started queued task",
            info: {
              providerID: "cliproxy",
              modelID: "gpt-5.4",
              mode: "primary",
              agent: "build",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
            },
            parts: []
          };
        })
      };
      const opencodeEvents = {
        ensureDirectory: jest.fn(),
        waitUntilConnected: jest.fn(async () => undefined)
      };

      const events = new EventsService(config as never);
      const streamStore = new TelegramStreamStore();
      streamStore.bindAdminChat(1, 123);
      streamStore.setStreamEnabled(1, false);
      const outboxStore = new TelegramOutboxStore();
      const outboxService = new TelegramOutboxService(streamStore, outboxStore);
      const bridge = new TelegramEventsOutboxBridge(events, outboxService, {
        finalizeAssistantReply: jest.fn()
      } as never, config as never);
      const handoffStore = new KanbanRunnerHandoffStore();
      const handoffService = new KanbanRunnerHandoffService(events, handoffStore, outboxStore);
      const runner = new KanbanRunnerService(
        config as never,
        kanban as never,
        runnerSessions as never,
        projects as never,
        opencode as never,
        opencodeEvents as never,
        events as never
      );
      const controller = new TelegramOutboxController(outboxStore, events);

      bridge.onModuleInit();
      handoffService.onModuleInit();
      events.subscribe((event) => (runner as any).onEvent(event));

      events.publish({
        type: "opencode.message",
        ts: new Date().toISOString(),
        data: {
          adminId: 1,
          projectSlug: "alpha",
          sessionId: "session-blocked",
          text: "Blocked task final answer",
          finalText: "Blocked task final answer",
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          agent: "build",
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
        }
      });
      events.publish({
        type: "kanban.runner.finished",
        ts: new Date().toISOString(),
        data: {
          taskId: "task-blocked",
          projectSlug: "alpha",
          sessionId: "session-blocked",
          status: "blocked",
          claimedBy: null,
          executionSource: null
        }
      });

      expect(handoffStore.listAll()).toHaveLength(1);
      expect(opencode.sendPromptToSession).not.toHaveBeenCalled();

      const leased = outboxStore.pull({ adminId: 1, limit: 10, workerId: "worker-1" });
      controller.report(
        {
          authAdminId: 1,
          headers: { "x-bot-worker-id": "worker-1" }
        } as never,
        {
          results: leased.map((item) => ({ id: item.id, ok: true, telegramMessageId: 500 }))
        }
      );

      await waitFor(() => {
        expect(opencode.sendPromptToSession).toHaveBeenCalledTimes(1);
      });
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
