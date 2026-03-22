/**
 * @fileoverview Best-effort project lifecycle event publishing for Telegram/outbox consumers.
 *
 * Exports:
 * - publishProjectLifecycleEvent - Publishes project lifecycle event with current container snapshot when available.
 */

import { EventsService } from "../events/events.service";
import { ProjectsService } from "./projects.service";

export const publishProjectLifecycleEvent = async (input: {
  projects: Pick<ProjectsService, "statusProject">;
  events: Pick<EventsService, "publish">;
  adminId: number | undefined;
  slug: string;
  action: "start" | "stop" | "restart";
}): Promise<void> => {
  /* Lifecycle notifications should still fire even when docker status inspection fails after the action. */
  try {
    const status = await input.projects.statusProject(input.slug);
    input.events.publish({
      type: "project.lifecycle",
      ts: new Date().toISOString(),
      data: {
        adminId: input.adminId ?? null,
        slug: input.slug,
        action: input.action,
        containers: status
      }
    });
  } catch {
    input.events.publish({
      type: "project.lifecycle",
      ts: new Date().toISOString(),
      data: {
        adminId: input.adminId ?? null,
        slug: input.slug,
        action: input.action,
        containers: []
      }
    });
  }
};
