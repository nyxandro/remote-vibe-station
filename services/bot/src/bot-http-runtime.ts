/**
 * @fileoverview HTTP bootstrap helpers for bot auth endpoints and graceful shutdown.
 *
 * Exports:
 * - DEFAULT_BOT_HTTP_PORT - Default HTTP port for bot auth/webhook server.
 * - resolveBotHttpPort - Parses PORT env with guarded fallback.
 * - shouldAttachCookieDomain - Decides whether auth cookies may include Domain attribute.
 * - startBotHttpServer - Starts the Express listener and exposes a close helper.
 * - registerBotShutdownHandlers - Wires SIGINT/SIGTERM cleanup for bot + HTTP server.
 */

import { isIP } from "node:net";

import { Express } from "express";

export const DEFAULT_BOT_HTTP_PORT = 3001;

export const resolveBotHttpPort = (value: string | undefined): number => {
  /* Parse user-provided PORT and fall back to the default when the value is invalid. */
  if (!value) {
    return DEFAULT_BOT_HTTP_PORT;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    // eslint-disable-next-line no-console
    console.warn(`Invalid PORT value '${value}', fallback to ${DEFAULT_BOT_HTTP_PORT}`);
    return DEFAULT_BOT_HTTP_PORT;
  }

  return parsed;
};

export const shouldAttachCookieDomain = (hostname: string): boolean => {
  /* Localhost/IP deployments require host-only cookies without Domain attribute. */
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") {
    return false;
  }
  return isIP(normalized) === 0;
};

export const startBotHttpServer = (app: Express, input?: { portEnv?: string }) => {
  /* Keep bot auth endpoints reachable in both polling and webhook modes. */
  const port = resolveBotHttpPort(input?.portEnv ?? process.env.PORT);
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Bot HTTP server is listening on port ${port}`);
  });

  server.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("Bot HTTP server failed to start", error);
    process.exit(1);
  });

  const closeHttpServer = async (): Promise<void> => {
    /* Ensure HTTP listener is closed during process shutdown. */
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  return {
    port,
    server,
    closeHttpServer
  };
};

export const registerBotShutdownHandlers = (input: {
  stopPeriodicCommandSync: () => void;
  stopBot: (signal: string) => void;
  closeHttpServer: () => Promise<void>;
}): void => {
  /* Keep shutdown flow identical for polling and webhook modes. */
  const handleShutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    /* Shutdown errors are logged and mark the process as failed instead of leaking rejections. */
    try {
      input.stopPeriodicCommandSync();
      input.stopBot(signal);
      await input.closeHttpServer();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Bot shutdown failed for signal ${signal}`, error);
      process.exitCode = 1;
    }
  };

  const register = (signal: "SIGINT" | "SIGTERM") => {
    process.once(signal, () => {
      void handleShutdown(signal);
    });
  };

  register("SIGINT");
  register("SIGTERM");
};
