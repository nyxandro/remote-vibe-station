/**
 * @fileoverview WebSocket gateway for event streaming.
 *
 * Exports:
 * - EventsGateway (L21) - Streams events to connected clients.
 */

import {
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import { IncomingMessage } from "node:http";
import { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Server, WebSocket } from "ws";

import { EventStreamAuthService } from "./event-stream-auth.service";
import { EventsService } from "./events.service";
import { EventEnvelope } from "./events.types";
import { WorkspaceStateChangedEventData } from "./workspace-events";

type ClientSubscription = {
  adminId: number;
  topics: Array<"kanban" | "terminal" | "workspace">;
  projectSlug: string | null;
};

@WebSocketGateway({ path: "/events" })
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  private server!: Server;

  private readonly clients = new Map<WebSocket, ClientSubscription>();
  private unsubscribe?: () => void;

  public constructor(
    private readonly events: EventsService,
    private readonly auth: EventStreamAuthService
  ) {}

  public afterInit(): void {
    /* Native ws gateway does not attach auth metadata automatically, so setup stays request-driven in handleConnection. */
  }

  public onModuleInit(): void {
    /* Subscribe to event stream and broadcast to clients. */
    this.unsubscribe = this.events.subscribe((event) => this.broadcast(event));
  }

  public onModuleDestroy(): void {
    /* Release event subscription on shutdown so tests and dev restarts do not leak listeners. */
    this.unsubscribe?.();
  }

  public handleConnection(client: WebSocket, request: IncomingMessage): void {
    /* Authenticate socket on handshake and only then register scoped replay/live delivery. */
    const subscription = this.resolveSubscription(request);
    if (!subscription) {
      client.close(1008, "Unauthorized");
      return;
    }

    this.clients.set(client, subscription);
    this.events
      .replay()
      .filter((event) => this.matches(subscription, event, true))
      .forEach((event) => this.send(client, event));
  }

  public handleDisconnect(client: WebSocket): void {
    /* Remove client and keep buffer for future connections. */
    this.clients.delete(client);
  }

  private broadcast(event: EventEnvelope): void {
    /* Broadcast only events that match each authenticated client subscription. */
    this.clients.forEach((subscription, client) => {
      if (this.matches(subscription, event, false)) {
        this.send(client, event);
      }
    });
  }

  private send(client: WebSocket, event: EventEnvelope): void {
    /* Send JSON payload if connection is open. */
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  }

  private resolveSubscription(request: IncomingMessage): ClientSubscription | null {
    /* Token is transported via query string because browser WebSocket APIs cannot send custom auth headers. */
    let token: string | null = null;
    try {
      const requestUrl = String(request.url ?? "").trim();
      const parsed = new URL(requestUrl, "http://localhost");
      token = parsed.searchParams.get("token")?.trim() ?? null;
    } catch {
      return null;
    }

    if (!token) {
      return null;
    }

    let verified: ReturnType<EventStreamAuthService["verifyToken"]>;
    try {
      verified = this.auth.verifyToken({ token });
    } catch {
      return null;
    }

    return verified
      ? {
          adminId: verified.adminId,
          topics: verified.topics,
          projectSlug: verified.projectSlug
        }
      : null;
  }

  private matches(subscription: ClientSubscription, event: EventEnvelope, isReplay: boolean): boolean {
    /* Keep gateway filtering explicit so only approved topics can leave the backend over `/events`. */
    if (!this.matchesAdminScope(subscription, event)) {
      return false;
    }

    if (event.type === "kanban.task.updated") {
      if (!subscription.topics.includes("kanban")) {
        return false;
      }

      const eventData = (event.data ?? {}) as { projectSlug?: string };
      const eventProjectSlug = typeof eventData.projectSlug === "string" ? eventData.projectSlug.trim() : "";
      return !subscription.projectSlug || !eventProjectSlug || eventProjectSlug === subscription.projectSlug;
    }

    if (event.type === "terminal.output") {
      if (isReplay || !subscription.topics.includes("terminal") || !subscription.projectSlug) {
        return false;
      }

      const eventData = (event.data ?? {}) as { slug?: string };
      const eventProjectSlug = typeof eventData.slug === "string" ? eventData.slug.trim() : "";
      return eventProjectSlug.length > 0 && eventProjectSlug === subscription.projectSlug.trim();
    }

    if (event.type === "workspace.state.changed") {
      if (isReplay || !subscription.topics.includes("workspace")) {
        return false;
      }

      const eventData = (event.data ?? {}) as WorkspaceStateChangedEventData;
      const eventProjectSlug = typeof eventData.projectSlug === "string" ? eventData.projectSlug.trim() : "";
      if (!subscription.projectSlug || eventProjectSlug.length === 0) {
        return true;
      }

      return eventProjectSlug === subscription.projectSlug.trim();
    }

    return false;
  }

  private matchesAdminScope(subscription: ClientSubscription, event: EventEnvelope): boolean {
    /* Admin-bound workspace events should not fan out to other authenticated operators. */
    const adminId = (event.data as { adminId?: unknown } | null)?.adminId;
    return typeof adminId !== "number" || adminId === subscription.adminId;
  }
}
