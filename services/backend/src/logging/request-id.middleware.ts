/**
 * @fileoverview Middleware for attaching request ids.
 *
 * Exports:
 * - REQUEST_ID_HEADER (L11) - Header name for request id.
 * - requestIdMiddleware (L13) - Adds x-request-id header.
 */

import { randomUUID } from "node:crypto";
import { Request, Response, NextFunction } from "express";

const REQUEST_ID_HEADER = "x-request-id";

export const requestIdMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction
): void => {
  /* Generate and attach request id for tracing. */
  const requestId = randomUUID();
  (request.headers as Record<string, string>)[REQUEST_ID_HEADER] = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  next();
};
