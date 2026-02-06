/**
 * @fileoverview WebSocket bridge from backend events to Telegram chat.
 *
 * Exports:
 * - EventEnvelope (L14) - Incoming event payload shape.
 * - WS_PATH (L19) - WebSocket path for events.
 * - EventsBridge (L21) - Connects to backend and forwards messages.
 */

import WebSocket from "ws";
import { Telegraf } from "telegraf";

import { BotConfig } from "./config";
import { splitMessage } from "./message-utils";
import { formatOpenCodeSsePayload } from "./opencode-event-parser";

type EventEnvelope = {
  type: string;
  data: Record<string, unknown>;
};

const WS_PATH = "/events";

export class EventsBridge {
  private socket: WebSocket | null = null;
  private activeChatId: number | null = null;
  private streamEnabled = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  public constructor(private readonly config: BotConfig, private readonly bot: Telegraf) {}

  public setActiveChat(chatId: number): void {
    /* Track the chat that should receive event output. */
    this.activeChatId = chatId;
  }

  public setStreamEnabled(enabled: boolean): void {
    /* Toggle forwarding of backend events to Telegram. */
    this.streamEnabled = enabled;
  }

  public isStreaming(): boolean {
    /* Expose current stream state to handlers. */
    return this.streamEnabled;
  }

  public connect(): void {
    /* Connect to backend WebSocket event stream. */
    const url = `${this.config.backendUrl.replace("http", "ws")}${WS_PATH}`;
    this.open(url);
  }

  private open(url: string): void {
    /*
     * Keep the bridge resilient: backend may restart.
     * We never crash the bot process on WS errors.
     */
    this.socket = new WebSocket(url);

    this.socket.on("message", (data) => {
      this.handleMessage(data.toString());
    });

    this.socket.on("error", () => {
      this.scheduleReconnect(url);
    });

    this.socket.on("close", () => {
      this.scheduleReconnect(url);
    });
  }

  private scheduleReconnect(url: string): void {
    /* Simple bounded reconnect loop. */
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open(url);
    }, 1000);
  }

  private handleMessage(raw: string): void {
    const event = JSON.parse(raw) as EventEnvelope;

    /* Allow backend to control stream state dynamically. */
    if (event.type === "telegram.stream") {
      const enabled = Boolean(event.data.enabled);
      const chatId = Number(event.data.chatId);
      if (Number.isFinite(chatId)) {
        /* If stream is enabled from Mini App, bind chat automatically. */
        if (!this.activeChatId) {
          this.activeChatId = chatId;
        }

        if (chatId === this.activeChatId) {
          this.streamEnabled = enabled;
        }
      }
      return;
    }

    /* Ignore non-control events when streaming is off. */
    if (!this.activeChatId || !this.streamEnabled) {
      return;
    }
    const text = this.formatEvent(event);

    if (!text) {
      return;
    }

    const chunks = splitMessage(text);
    chunks.forEach((chunk) => {
      void this.bot.telegram.sendMessage(this.activeChatId as number, chunk);
    });
  }

  private formatEvent(event: EventEnvelope): string | null {
    /* Reduce event payloads to readable text. */
    if (event.type === "opencode.message") {
      return String(event.data.text ?? "");
    }

    if (event.type === "terminal.output") {
      /* Do not forward terminal output to Telegram. */
      return null;
    }

    if (event.type === "opencode.event") {
      /* Keep Telegram chat clean: only forward final assistant messages. */
      return null;
    }

    if (event.type === "project.selected") {
      /* Friendly notification when active project changes. */
      const slug = String((event.data as any)?.slug ?? "");
      const name = String((event.data as any)?.name ?? slug);
      const rootPath = String((event.data as any)?.rootPath ?? "");
      return `📁 Выбран проект: ${name}\n${rootPath}`;
    }

    return null;
  }
}

// Terminal prompt parsing removed: Telegram stream should stay chat-focused.
