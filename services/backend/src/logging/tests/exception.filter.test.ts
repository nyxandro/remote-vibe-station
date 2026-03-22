/**
 * @fileoverview Tests for backend error contract normalization in global exception filter.
 */

import { ArgumentsHost, BadRequestException } from "@nestjs/common";
import { Request, Response } from "express";

import { createAppErrorBody } from "../app-error";
import { AllExceptionsFilter } from "../exception.filter";
import { REQUEST_ID_HEADER } from "../request-id.middleware";

const makeHost = (input: { requestId: string }) => {
  const request = {
    method: "POST",
    url: "/api/projects",
    headers: {
      [REQUEST_ID_HEADER]: input.requestId
    }
  } as unknown as Request;
  const response = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  } as unknown as Response;

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response
    })
  } as unknown as ArgumentsHost;

  return { request, response, host };
};

describe("AllExceptionsFilter", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("returns structured app error body with requestId for explicit app exceptions", () => {
    /* HTTP exceptions that already carry code/message/hint should pass through unchanged. */
    const filter = new AllExceptionsFilter();
    const { response, host } = makeHost({ requestId: "req-123" });
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    filter.catch(
      new BadRequestException(
        createAppErrorBody({
          code: "APP_PROJECT_PAYLOAD_INVALID",
          message: "Project payload is invalid.",
          hint: "Provide project name, slug, root path, compose path, service name and service port."
        })
      ),
      host
    );

    expect((response.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect((response.json as jest.Mock)).toHaveBeenCalledWith({
      statusCode: 400,
      code: "APP_PROJECT_PAYLOAD_INVALID",
      message: "Project payload is invalid.",
      hint: "Provide project name, slug, root path, compose path, service name and service port.",
      requestId: "req-123"
    });
  });

  it("parses prefixed legacy messages into the new contract", () => {
    /* Existing CODE: message strings must still become structured JSON without controller rewrites. */
    const filter = new AllExceptionsFilter();
    const { response, host } = makeHost({ requestId: "req-456" });
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    filter.catch(
      new BadRequestException(
        "APP_EVENT_STREAM_PROJECT_SCOPE_REQUIRED: Terminal subscriptions require project scope. Select a project and retry."
      ),
      host
    );

    expect((response.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect((response.json as jest.Mock)).toHaveBeenCalledWith({
      statusCode: 400,
      code: "APP_EVENT_STREAM_PROJECT_SCOPE_REQUIRED",
      message: "Terminal subscriptions require project scope. Select a project and retry.",
      hint: "Check request data and retry.",
      requestId: "req-456"
    });
  });

  it("hides raw internal errors behind a stable 500 contract", () => {
    /* Unexpected runtime failures should not leak internal exception text to the client. */
    const filter = new AllExceptionsFilter();
    const { response, host } = makeHost({ requestId: "req-500" });
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    filter.catch(new Error("database password leaked"), host);

    expect((response.status as jest.Mock)).toHaveBeenCalledWith(500);
    expect((response.json as jest.Mock)).toHaveBeenCalledWith({
      statusCode: 500,
      code: "APP_INTERNAL_ERROR",
      message: "Unexpected server error while processing request.",
      hint: "Retry the request. If it keeps failing, inspect backend logs with requestId.",
      requestId: "req-500"
    });
  });
});
