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
  private readonly connectedDirectories = new Set<string>();
  private readonly permissionWatchers = new Set<string>();

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
    this.connectedDirectories.clear();
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

  public async waitUntilConnected(directory: string, timeoutMs = 2_000): Promise<void> {
    /* Avoid missing early runtime events (eg permission.asked) right after prompt submit. */
    const normalized = directory.trim();
    if (!normalized) {
      return;
    }

    this.ensureDirectory(normalized);
    if (this.connectedDirectories.has(normalized)) {
      return;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (this.connectedDirectories.has(normalized)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  public watchPermissionOnce(input: { directory: string; sessionID: string; timeoutMs?: number }): void {
    /*
     * Dedicated short-lived watcher for permission prompts.
     * This protects Telegram approval flow when the long-lived SSE loop reconnects late.
     */
    const directory = input.directory.trim();
    const sessionID = input.sessionID.trim();
    if (!directory || !sessionID) {
      return;
    }

    const watcherKey = `${directory}:${sessionID}`;
    if (this.permissionWatchers.has(watcherKey)) {
      return;
    }

    this.permissionWatchers.add(watcherKey);
    void this.runPermissionWatcher({
      directory,
      sessionID,
      timeoutMs: input.timeoutMs ?? 90_000,
      watcherKey
    });
  }

  private async connectLoop(directory: string): Promise<void> {
    /* Reconnect forever to avoid losing runtime events after transient failures. */
    const retryDelayMs = 2_000;

    while (this.running && this.watchedDirectories.has(directory)) {
      try {
        await this.connect(directory);
      } catch (error) {
        this.connectedDirectories.delete(directory);
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

    this.connectedDirectories.delete(directory);
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
      `${this.config.opencodeServerUrl}/global/event`,
      {
      headers
      }
    );

    if (!response.ok || !response.body) {
      throw new Error(`OpenCode SSE connection failed: ${response.status}`);
    }

    this.connectedDirectories.add(directory);
    // eslint-disable-next-line no-console
    console.log(`[opencode-events] connected directory=${directory}`);

    await this.readStream(response.body, directory);
  }

  private async runPermissionWatcher(input: {
    directory: string;
    sessionID: string;
    timeoutMs: number;
    watcherKey: string;
  }): Promise<void> {
    const headers = new Headers({ Accept: "text/event-stream" });
    if (this.config.opencodeServerPassword && this.config.opencodeServerUsername) {
      const credentials = `${this.config.opencodeServerUsername}:${this.config.opencodeServerPassword}`;
      headers.set("Authorization", `Basic ${Buffer.from(credentials).toString("base64")}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await fetch(
        `${this.config.opencodeServerUrl}/global/event`,
        { headers, signal: controller.signal }
      );

      if (!response.ok || !response.body) {
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
            continue;
          }

          if (line.startsWith(SSE_DATA_PREFIX)) {
            dataLines.push(line.slice(SSE_DATA_PREFIX.length).trim());
            continue;
          }

          if (line.trim() !== "") {
            continue;
          }

          const payload = dataLines.join("\n");
          dataLines = [];
          if (!payload) {
            continue;
          }

          try {
            const parsed = JSON.parse(payload) as Record<string, unknown>;
            const globalPayload =
              parsed.payload && typeof parsed.payload === "object"
                ? (parsed.payload as Record<string, unknown>)
                : null;
            if (globalPayload && String(parsed.directory ?? "") !== input.directory) {
              continue;
            }

            const event = globalPayload ?? parsed;
            const eventType = String(event.type ?? "");
            if (eventType !== "permission.asked" && eventType !== "permission.updated") {
              continue;
            }

            const properties =
              event.properties && typeof event.properties === "object"
                ? (event.properties as Record<string, unknown>)
                : (event as Record<string, unknown>);
            if (String(properties.sessionID ?? "") !== input.sessionID) {
              continue;
            }

            this.events.publish({
              type: "opencode.event",
              ts: new Date().toISOString(),
              data: { eventName: "permission.asked", payload: JSON.stringify(event), directory: input.directory }
            });
            controller.abort();
            return;
          } catch {
            continue;
          }
        }
      }
    } catch {
      /* Best effort watcher: failures are acceptable because main loop still runs. */
    } finally {
      clearTimeout(timeout);
      this.permissionWatchers.delete(input.watcherKey);
    }
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
    const rawPayload = dataLines.join("\n");
    if (!rawPayload) {
      return;
    }

    let payload = rawPayload;
    let normalizedEventName = eventName;

    /* Global event stream wraps payload with { directory, payload }. */
    try {
      const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
      const wrappedPayload = parsed.payload;
      if (wrappedPayload && typeof wrappedPayload === "object") {
        const eventDirectory = String(parsed.directory ?? "").trim();
        if (eventDirectory && eventDirectory !== directory) {
          return;
        }

        payload = JSON.stringify(wrappedPayload);
        normalizedEventName = String((wrappedPayload as Record<string, unknown>).type ?? eventName);
      }
    } catch {
      /* Keep raw payload when event is not JSON or not wrapped. */
    }

    this.events.publish({
      type: "opencode.event",
      ts: new Date().toISOString(),
      data: { eventName: normalizedEventName, payload, directory }
    });

    if (normalizedEventName === "permission.asked" || normalizedEventName === "permission.updated") {
      // eslint-disable-next-line no-console
      console.log(`[opencode-events] permission event=${normalizedEventName} directory=${directory}`);
    }
  }
}
