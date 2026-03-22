/**
 * @fileoverview Middleware for attaching request ids.
 *
 * Exports:
 * - REQUEST_ID_HEADER (L11) - Header name for request id.
 * - requestIdMiddleware (L13) - Adds x-request-id header.
 */

import { randomUUID } from "node:crypto";
import { Request, Response, NextFunction } from "express";

export const REQUEST_ID_HEADER = "x-request-id";

export const requestIdMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction
): void => {
  /* Preserve upstream correlation id when present, otherwise mint a new one locally. */
  const existing = typeof request.headers[REQUEST_ID_HEADER] === "string" ? request.headers[REQUEST_ID_HEADER] : null;
  const requestId = existing?.trim() || randomUUID();
  (request.headers as Record<string, string>)[REQUEST_ID_HEADER] = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  next();
};
