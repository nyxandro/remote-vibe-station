/**
 * @fileoverview Tests for long-running OpenCode HTTP dispatcher settings.
 *
 * Exports:
 * - none (Jest suite).
 */

import * as http from "node:http";

import { Client, request } from "undici";

import {
  buildOpenCodeLongRunningRequestInit,
  OPENCODE_LONG_RUNNING_HEADERS_TIMEOUT_MS
} from "../opencode-http-dispatcher";

describe("OpenCode long-running HTTP dispatcher", () => {
  test("uses a long finite response-header timeout for approval-gated prompt turns", async () => {
    /*
     * A delayed local response exercises the undici HTTP dispatcher path that
     * production OpenCode prompt calls use while staying deterministic in tests.
     */
    const HEADER_DELAY_MS = 1_500;
    const TOO_SHORT_HEADERS_TIMEOUT_MS = 100;
    const server = http.createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      }, HEADER_DELAY_MS);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("APP_TEST_SERVER_ADDRESS_INVALID: Local HTTP test server did not expose a TCP port.");
    }

    const url = `http://127.0.0.1:${address.port}/delayed-headers`;
    const requestInit = buildOpenCodeLongRunningRequestInit({ method: "POST" });

    try {
      const shortTimeoutClient = new Client(`http://127.0.0.1:${address.port}`, {
        headersTimeout: TOO_SHORT_HEADERS_TIMEOUT_MS
      });

      try {
        await expect(request(url, { method: "POST", dispatcher: shortTimeoutClient })).rejects.toThrow(
          "Headers Timeout Error"
        );
      } finally {
        await shortTimeoutClient.close();
      }

      const dispatcherState = await fetch(url, requestInit as any).then((response) => response.json());
      expect(dispatcherState).toEqual({ ok: true });
      expect(OPENCODE_LONG_RUNNING_HEADERS_TIMEOUT_MS).toBeGreaterThan(HEADER_DELAY_MS);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
