/**
 * @fileoverview SSE bridge from OpenCode server to WebSocket events.
 *
 * Exports:
 * - SSE_EVENT_PREFIX (L13) - SSE event line prefix.
 * - SSE_DATA_PREFIX (L14) - SSE data line prefix.
 * - OpenCodeEventsService (L17) - Subscribes to OpenCode /event stream.
 */

import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { EventsService } from "../events/events.service";

const SSE_EVENT_PREFIX = "event:";
const SSE_DATA_PREFIX = "data:";

@Injectable()
export class OpenCodeEventsService implements OnModuleInit, OnModuleDestroy {
  private running = false;
  private readonly watchedDirectories = new Set<string>();
  private readonly startedDirectoryLoops = new Set<string>();

  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly events: EventsService
  ) {}

  public onModuleInit(): void {
    /* Start resilient SSE consumption loops in background. */
    this.running = true;
    this.ensureDirectory(process.cwd());
  }

  public onModuleDestroy(): void {
    /* Stop reconnect loop on application shutdown. */
    this.running = false;
    this.watchedDirectories.clear();
    this.startedDirectoryLoops.clear();
  }

  public ensureDirectory(directory: string): void {
    /* Keep one SSE loop per active OpenCode directory context. */
    const normalized = directory.trim();
    if (!normalized) {
      return;
    }

    this.watchedDirectories.add(normalized);
    if (!this.running || this.startedDirectoryLoops.has(normalized)) {
      return;
    }

    this.startedDirectoryLoops.add(normalized);
    void this.connectLoop(normalized);
  }

  private async connectLoop(directory: string): Promise<void> {
    /* Reconnect forever to avoid losing runtime events after transient failures. */
    const retryDelayMs = 2_000;

    while (this.running && this.watchedDirectories.has(directory)) {
      try {
        await this.connect(directory);
      } catch (error) {
        this.events.publish({
          type: "opencode.event.error",
          ts: new Date().toISOString(),
          data: {
            message: error instanceof Error ? error.message : "OpenCode SSE bridge failed",
            directory
          }
        });
      }

      if (!this.running) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }

    this.startedDirectoryLoops.delete(directory);
  }

  private async connect(directory: string): Promise<void> {
    /* Open SSE connection to OpenCode server. */
    const headers = new Headers({ Accept: "text/event-stream" });

    if (this.config.opencodeServerPassword && this.config.opencodeServerUsername) {
      const credentials = `${this.config.opencodeServerUsername}:${this.config.opencodeServerPassword}`;
      const encoded = Buffer.from(credentials).toString("base64");
      headers.set("Authorization", `Basic ${encoded}`);
    }

    const response = await fetch(
      `${this.config.opencodeServerUrl}/event?directory=${encodeURIComponent(directory)}`,
      {
      headers
      }
    );

    if (!response.ok || !response.body) {
      throw new Error(`OpenCode SSE connection failed: ${response.status}`);
    }

    await this.readStream(response.body, directory);
  }

  private async readStream(stream: ReadableStream<Uint8Array>, directory: string): Promise<void> {
    /* Parse SSE stream line by line. */
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let dataLines: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith(SSE_EVENT_PREFIX)) {
          currentEvent = line.slice(SSE_EVENT_PREFIX.length).trim();
          continue;
        }

        if (line.startsWith(SSE_DATA_PREFIX)) {
          dataLines.push(line.slice(SSE_DATA_PREFIX.length).trim());
          continue;
        }

        if (line.trim() === "") {
          this.publishEvent(currentEvent, dataLines, directory);
          dataLines = [];
          currentEvent = "message";
        }
      }
    }
  }

  private publishEvent(eventName: string, dataLines: string[], directory: string): void {
    /* Publish SSE payload as a structured event. */
    const payload = dataLines.join("\n");
    this.events.publish({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: { eventName, payload, directory }
    });
  }
}
