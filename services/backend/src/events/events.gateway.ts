/**
 * @fileoverview WebSocket gateway for event streaming.
 *
 * Exports:
 * - EventsGateway (L21) - Streams events to connected clients.
 */

import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import { OnModuleInit } from "@nestjs/common";
import { Server, WebSocket } from "ws";

import { EventsService } from "./events.service";
import { EventEnvelope } from "./events.types";

@WebSocketGateway({ path: "/events" })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  private server!: Server;

  private readonly clients = new Set<WebSocket>();
  private unsubscribe?: () => void;

  public constructor(private readonly events: EventsService) {}

  public onModuleInit(): void {
    /* Subscribe to event stream and broadcast to clients. */
    this.unsubscribe = this.events.subscribe((event) => this.broadcast(event));
  }

  public handleConnection(client: WebSocket): void {
    /* Register client and replay buffered events. */
    this.clients.add(client);
    this.events.replay().forEach((event) => this.send(client, event));
  }

  public handleDisconnect(client: WebSocket): void {
    /* Remove client and keep buffer for future connections. */
    this.clients.delete(client);
  }

  private broadcast(event: EventEnvelope): void {
    /* Broadcast event to all connected clients. */
    this.clients.forEach((client) => this.send(client, event));
  }

  private send(client: WebSocket, event: EventEnvelope): void {
    /* Send JSON payload if connection is open. */
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  }
}
