/**
 * @fileoverview Publishes explicit OpenCode runtime turn start events for Telegram replay barriers.
 *
 * Exports:
 * - publishPromptRuntimeTurnStarted - Announces that one prompt/command turn is now active for a resolved session.
 */

import { EventsService } from "../events/events.service";

export const publishPromptRuntimeTurnStarted = (
  events: EventsService,
  input: {
    adminId?: number;
    projectSlug: string;
    directory: string;
    sessionID: string;
    providerID?: string;
    modelID?: string;
    thinking?: string | null;
    agent?: string | null;
  }
): void => {
  /* Telegram runtime bridge needs a turn-open marker before it accepts SSE progress for a session again. */
  events.publish({
    type: "opencode.turn.started",
    ts: new Date().toISOString(),
    data: {
        adminId: input.adminId ?? null,
        projectSlug: input.projectSlug,
        directory: input.directory,
        sessionId: input.sessionID,
        providerID: input.providerID ?? null,
        modelID: input.modelID ?? null,
        thinking: input.thinking ?? null,
        agent: input.agent ?? null
      }
    });
};
