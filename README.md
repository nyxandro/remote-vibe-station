# OpenCode Telegram Control (VPS)

This repository contains the specification and starter scaffold for remote OpenCode control via Telegram (chat + Mini App) on a VPS.

Core model: 1 server -> 1 OpenCode -> 1 Telegram account.

## Documentation

- Full specification: `docs/OPENCODE_TELEGRAM_PLAN.md`

## Quick start (scaffold)

1. Copy `.env.example` to `.env` and fill required values.
2. Configure DNS: `<domain.tld>` and `*.<domain.tld>` to the VPS IP.
3. Ensure `/srv/projects` exists on the server.
4. Start the stack: `docker compose up -d`.

See `docs/OPENCODE_TELEGRAM_PLAN.md` for the full process.

## Development (hot reload for Mini App)

To run Mini App with hot reload and avoid manual rebuilds:

1. Start dev stack: `docker compose -f docker-compose.dev.yml up -d`
2. Open Mini App: `http://localhost:4173/miniapp/`
3. Tail logs if needed: `docker compose -f docker-compose.dev.yml logs -f miniapp`

In this mode, Mini App source is bind-mounted and Vite HMR applies changes immediately.
