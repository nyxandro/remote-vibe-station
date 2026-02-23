/**
 * @fileoverview Bridge from backend event bus to Telegram outbox.
 *
 * Why:
 * - Producers publish events to EventsService.
 * - Telegram delivery needs reliability and persistence.
 * - We keep this policy in one place.
 *
 * Exports:
 * - TelegramEventsOutboxBridge (L23) - Subscribes to EventsService on startup.
 */

import { Injectable, OnModuleInit } from "@nestjs/common";

import { EventsService } from "../../events/events.service";
import { EventEnvelope } from "../../events/events.types";
import { TelegramOutboxService } from "./telegram-outbox.service";

@Injectable()
export class TelegramEventsOutboxBridge implements OnModuleInit {
  public constructor(
    private readonly events: EventsService,
    private readonly outbox: TelegramOutboxService
  ) {}

  public onModuleInit(): void {
    /* Subscribe once; EventsService lives for the process lifetime. */
    this.events.subscribe((event) => this.onEvent(event));
  }

  private onEvent(event: EventEnvelope): void {
    /* Route selected events into outbox. */
    if (event.type === "opencode.message") {
      const adminId = this.extractAdminId(event);
      if (!adminId) {
        return;
      }

      const data = event.data as any;
      this.outbox.enqueueAssistantReply({
        adminId,
        delivery: {
          text: String(data?.text ?? ""),
          contextLimit: typeof data?.contextLimit === "number" ? data.contextLimit : null,
          providerID: String(data?.providerID ?? ""),
          modelID: String(data?.modelID ?? ""),
          thinking: typeof data?.thinking === "string" ? data.thinking : null,
          agent: String(data?.agent ?? ""),
          tokens: data?.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          telemetry: data?.telemetry
        }
      });
      return;
    }

    if (event.type === "project.selected") {
      const adminId = this.extractAdminId(event);
      if (!adminId) {
        return;
      }

      const slug = String((event.data as any)?.slug ?? "");
      const name = String((event.data as any)?.name ?? slug);
      const rootPath = String((event.data as any)?.rootPath ?? "");
      const message = `📁 Выбран проект: ${name}\n${rootPath}`;

      this.outbox.enqueueStreamNotification({ adminId, text: message });
      return;
    }

    if (event.type === "project.lifecycle") {
      /*
       * Operational feedback for Mini App actions (start/stop/restart).
       * Must be visible even when stream is disabled.
       */
      const adminId = this.extractAdminId(event);
      if (!adminId) {
        return;
      }

      const payload = event.data as any;
      const slug = String(payload?.slug ?? "");
      const action = String(payload?.action ?? "");
      const containers = Array.isArray(payload?.containers) ? payload.containers : [];

      const header = action === "start"
        ? `🚀 Запуск проекта: ${slug}`
        : action === "restart"
          ? `🔁 Перезапуск проекта: ${slug}`
          : action === "stop"
            ? `🛑 Остановка проекта: ${slug}`
            : `⚙️ Действие проекта: ${slug}`;

      const lines: string[] = [header];

      if (containers.length === 0) {
        lines.push("Контейнеры: нет данных (docker compose ps пустой ответ)");
      } else {
        lines.push(`Контейнеры: ${containers.length}`);
        for (const item of containers) {
          const service = String(item?.service ?? item?.name ?? "unknown");
          const state = String(item?.state ?? "unknown");
          const ports = Array.isArray(item?.ports) ? item.ports.filter((p: any) => typeof p === "string") : [];
          const portsSuffix = ports.length ? ` (${ports.join(", ")})` : "";
          lines.push(`- ${service}: ${state}${portsSuffix}`);
        }
      }

      this.outbox.enqueueAdminNotification({ adminId, text: lines.join("\n") });
      return;
    }
  }

  private extractAdminId(event: EventEnvelope): number | null {
    /*
     * Admin identity must be explicit.
     * If a producer doesn't include it, we cannot route to a chat safely.
     */
    const raw = (event.data as any)?.adminId;
    const id = typeof raw === "number" ? raw : raw === null || typeof raw === "undefined" ? null : Number(raw);
    return id && Number.isFinite(id) ? id : null;
  }
}
