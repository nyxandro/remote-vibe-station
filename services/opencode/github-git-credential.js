#!/usr/bin/env node

/**
 * @fileoverview Git credential helper that asks backend for short-lived GitHub App tokens.
 *
 * Exports:
 * - none (CLI script used via `git credential` helper protocol)
 */

const HELPER_TIMEOUT_MS = 10_000;

const readStdin = async () => {
  /* Git passes credential context via stdin, so collect it before contacting backend. */
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk.toString("utf8");
  }
  return raw;
};

const parseCredentialFields = (raw) => {
  /* Git emits key=value pairs; blank lines terminate the request payload. */
  return raw
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .reduce((acc, line) => {
      const separatorIndex = line.indexOf("=");
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1);
      if (key) {
        acc[key] = value;
      }
      return acc;
    }, {});
};

const main = async () => {
  /* Only `get` requests need a response; `store`/`erase` are intentionally no-ops for ephemeral tokens. */
  const operation = String(process.argv[2] ?? "get").trim().toLowerCase();
  if (operation !== "get") {
    return;
  }

  const fields = parseCredentialFields(await readStdin());
  const protocol = String(fields.protocol ?? "").trim().toLowerCase();
  const host = String(fields.host ?? "").trim().toLowerCase();

  /* Ignore non-GitHub remotes so other credential helpers or SSH can continue unaffected. */
  if (protocol !== "https" || host !== "github.com") {
    return;
  }

  /* Internal helper depends on explicit backend wiring; missing env is a hard misconfiguration. */
  const backendUrl = String(process.env.BACKEND_URL ?? "").trim();
  const sharedToken = String(process.env.BOT_BACKEND_AUTH_TOKEN ?? "").trim();
  if (!backendUrl) {
    throw new Error("BACKEND_URL is required for GitHub git credential helper");
  }
  if (!sharedToken) {
    throw new Error("BOT_BACKEND_AUTH_TOKEN is required for GitHub git credential helper");
  }

  /* Ask backend for the globally configured GitHub PAT used by runtime git operations. */
  const response = await fetch(`${backendUrl}/api/internal/github/git-credential`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bot-backend-token": sharedToken
    },
    body: JSON.stringify({
      protocol,
      host,
      path: typeof fields.path === "string" ? fields.path : ""
    }),
    signal: AbortSignal.timeout(HELPER_TIMEOUT_MS)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub credential request failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  const username = String(payload?.username ?? "").trim();
  const password = String(payload?.password ?? "").trim();
  if (!username || !password) {
    throw new Error("GitHub credential payload is missing username or password");
  }

  /* Emit only git-credential fields so git can continue without parsing stderr noise. */
  process.stdout.write(`username=${username}\npassword=${password}\n\n`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
