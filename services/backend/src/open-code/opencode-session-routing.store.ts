/**
 * @fileoverview In-memory routing map from OpenCode session to Telegram admin context.
 *
 * Exports:
 * - OpenCodeSessionRoutingStore (L18) - Bind/resolve session owner and directory.
 */

import { Injectable } from "@nestjs/common";
import * as crypto from "node:crypto";

type SessionRoute = {
  adminId: number;
  directory: string;
  updatedAtMs: number;
};

type QuestionRoute = {
  requestID: string;
  sessionID: string;
  adminId: number;
  directory: string;
  options: string[];
  updatedAtMs: number;
};

type PermissionRoute = {
  routeID: string;
  sessionID: string;
  adminId: number;
  directory: string;
  permissionID: string;
  updatedAtMs: number;
};

type SessionTokenRoute = {
  sessionID: string;
  adminId: number;
  directory: string;
  updatedAtMs: number;
};

const STALE_ROUTE_TTL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class OpenCodeSessionRoutingStore {
  private readonly routes = new Map<string, SessionRoute>();
  private readonly questions = new Map<string, QuestionRoute>();
  private readonly questionTokenToRequest = new Map<string, string>();
  private readonly permissions = new Map<string, PermissionRoute>();
  private readonly permissionTokenToRoute = new Map<string, string>();
  private readonly sessionTokens = new Map<string, SessionTokenRoute>();

  public bind(sessionID: string, input: { adminId: number; directory: string }): void {
    /* Refresh route whenever session is used in Telegram prompt flow. */
    this.prune(Date.now());
    this.routes.set(sessionID, {
      adminId: input.adminId,
      directory: input.directory,
      updatedAtMs: Date.now()
    });
  }

  public resolve(sessionID: string): { adminId: number; directory: string } | null {
    /* Resolve current owner context for SSE question/progress routing. */
    this.prune(Date.now());
    const route = this.routes.get(sessionID);
    if (!route) {
      return null;
    }

    return {
      adminId: route.adminId,
      directory: route.directory
    };
  }

  public bindQuestion(input: {
    requestID: string;
    sessionID: string;
    adminId: number;
    directory: string;
    options: string[];
  }): string {
    /* Keep question routing metadata for callback replies. */
    this.prune(Date.now());
    this.questions.set(input.requestID, {
      ...input,
      updatedAtMs: Date.now()
    });

    const token = crypto.createHash("sha1").update(input.requestID).digest("hex").slice(0, 16);
    this.questionTokenToRequest.set(token, input.requestID);
    return token;
  }

  public resolveQuestion(requestID: string): {
    sessionID: string;
    adminId: number;
    directory: string;
    options: string[];
  } | null {
    /* Resolve question request context for Telegram inline callback reply. */
    this.prune(Date.now());
    const route = this.questions.get(requestID);
    if (!route) {
      return null;
    }

    return {
      sessionID: route.sessionID,
      adminId: route.adminId,
      directory: route.directory,
      options: route.options
    };
  }

  public consumeQuestion(requestID: string): void {
    /* Remove handled question to avoid duplicate callbacks. */
    this.questions.delete(requestID);
    for (const [token, currentRequest] of this.questionTokenToRequest.entries()) {
      if (currentRequest === requestID) {
        this.questionTokenToRequest.delete(token);
      }
    }
  }

  public resolveQuestionToken(token: string): string | null {
    /* Resolve compact callback token back to original request id. */
    this.prune(Date.now());
    return this.questionTokenToRequest.get(token) ?? null;
  }

  public bindPermission(input: {
    routeID: string;
    sessionID: string;
    adminId: number;
    directory: string;
    permissionID: string;
  }): string {
    /* Keep permission routing metadata for inline callback confirmation. */
    this.prune(Date.now());
    this.permissions.set(input.routeID, {
      ...input,
      updatedAtMs: Date.now()
    });

    const token = crypto.createHash("sha1").update(input.routeID).digest("hex").slice(0, 16);
    this.permissionTokenToRoute.set(token, input.routeID);
    return token;
  }

  public resolvePermission(routeID: string): {
    sessionID: string;
    adminId: number;
    directory: string;
    permissionID: string;
  } | null {
    /* Resolve permission request context for Telegram inline callback reply. */
    this.prune(Date.now());
    const route = this.permissions.get(routeID);
    if (!route) {
      return null;
    }

    return {
      sessionID: route.sessionID,
      adminId: route.adminId,
      directory: route.directory,
      permissionID: route.permissionID
    };
  }

  public consumePermission(routeID: string): void {
    /* Remove handled permission route to avoid duplicate callbacks. */
    this.permissions.delete(routeID);
    for (const [token, currentRoute] of this.permissionTokenToRoute.entries()) {
      if (currentRoute === routeID) {
        this.permissionTokenToRoute.delete(token);
      }
    }
  }

  public resolvePermissionToken(token: string): string | null {
    /* Resolve compact callback token back to original permission route id. */
    this.prune(Date.now());
    return this.permissionTokenToRoute.get(token) ?? null;
  }

  public bindSession(input: { sessionID: string; adminId: number; directory: string }): string {
    /* Bind short callback token to session id for inline Telegram picker. */
    this.prune(Date.now());
    const hashSource = `${input.adminId}:${input.directory}:${input.sessionID}`;
    const token = crypto.createHash("sha1").update(hashSource).digest("hex").slice(0, 16);

    this.sessionTokens.set(token, {
      sessionID: input.sessionID,
      adminId: input.adminId,
      directory: input.directory,
      updatedAtMs: Date.now()
    });

    return token;
  }

  public resolveSessionToken(token: string): { sessionID: string; adminId: number; directory: string } | null {
    /* Resolve callback token and refresh TTL while picker remains active. */
    this.prune(Date.now());
    const route = this.sessionTokens.get(token);
    if (!route) {
      return null;
    }

    route.updatedAtMs = Date.now();
    return {
      sessionID: route.sessionID,
      adminId: route.adminId,
      directory: route.directory
    };
  }

  public consumeSessionToken(token: string): void {
    /* Drop used token to prevent stale replays across admins/chats. */
    this.sessionTokens.delete(token);
  }

  private prune(nowMs: number): void {
    /* Prevent unbounded map growth on long-running backend process. */
    for (const [sessionID, route] of this.routes.entries()) {
      if (nowMs - route.updatedAtMs > STALE_ROUTE_TTL_MS) {
        this.routes.delete(sessionID);
      }
    }

    for (const [requestID, route] of this.questions.entries()) {
      if (nowMs - route.updatedAtMs > STALE_ROUTE_TTL_MS) {
        this.questions.delete(requestID);
      }
    }

    for (const [token, requestID] of this.questionTokenToRequest.entries()) {
      if (!this.questions.has(requestID)) {
        this.questionTokenToRequest.delete(token);
      }
    }

    for (const [routeID, route] of this.permissions.entries()) {
      if (nowMs - route.updatedAtMs > STALE_ROUTE_TTL_MS) {
        this.permissions.delete(routeID);
      }
    }

    for (const [token, routeID] of this.permissionTokenToRoute.entries()) {
      if (!this.permissions.has(routeID)) {
        this.permissionTokenToRoute.delete(token);
      }
    }

    for (const [token, route] of this.sessionTokens.entries()) {
      if (nowMs - route.updatedAtMs > STALE_ROUTE_TTL_MS) {
        this.sessionTokens.delete(token);
      }
    }
  }
}
