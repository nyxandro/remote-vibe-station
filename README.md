# Remote Vibe Station

Remote Vibe Station is a Docker-based remote development workspace built around OpenCode, Telegram, and a browser-accessible control surface.

It is designed for a server-first workflow: deploy the stack on a remote Linux host, manage coding sessions from Telegram, open the Mini App for visual operations, and jump into OpenCode Web UI when you need a larger screen.

## Why this project exists

- Run an AI-assisted coding environment on a remote server instead of your local machine.
- Control the environment from Telegram, including prompts, sessions, approvals, project selection, and operational actions.
- Expose a secure browser UI for OpenCode and a Telegram Mini App for project management.
- Route model access through CLIProxy so the runtime can work with multiple model providers and account types.
- Keep the runtime deployable as Docker images without requiring a source checkout on the target host.

## Core capabilities

- Telegram-first OpenCode workflow for prompts, slash commands, progress, approvals, runtime notices, and session control.
- Telegram Mini App for project selection, file browsing, Git operations, runtime settings, providers, and project tools.
- Secure browser access to OpenCode Web UI through magic-link/forward-auth flow.
- CLIProxy-backed model catalog with dynamic model discovery for the OpenCode runtime.
- Runtime service management for backend, bot, Mini App, OpenCode, reverse proxy, and auxiliary infrastructure.
- Voice control support for Telegram voice messages via Groq transcription.
- Persistent outbox/event bridge so Telegram receives assistant replies, tool progress, todo updates, and permission prompts reliably.

## Architecture overview

The runtime is split into a small number of focused services:

| Service | Purpose |
| --- | --- |
| `services/bot` | Telegram bot built with Telegraf. Accepts admin commands, forwards prompts, polls backend outbox, and grants browser access to OpenCode. |
| `services/backend` | NestJS orchestration layer. Owns projects, prompts, sessions, runtime events, file APIs, provider management, and Telegram-facing APIs. |
| `services/miniapp` | React + Vite Telegram Mini App for visual workspace management. |
| `services/opencode` | OpenCode server runtime exposed behind Traefik and configured dynamically at container startup. |
| `cliproxy` | OpenAI-compatible model gateway used by OpenCode for provider/model access. |
| `proxy` | Traefik reverse proxy handling TLS, host/path routing, and OpenCode auth middleware. |

## How it works

### Telegram prompt flow

1. An admin sends a prompt or command to the Telegram bot.
2. The bot forwards the request to the backend.
3. The backend resolves the active project, selected OpenCode session, model, thinking mode, and agent.
4. The backend sends the request to OpenCode over HTTP.
5. In parallel, the backend listens to OpenCode runtime events and converts them into Telegram-friendly updates.
6. The bot polls the backend outbox and delivers text replies, progress updates, todo changes, cooldown notices, and approval prompts to Telegram.

### Web UI flow

- OpenCode runs in server mode and is not exposed directly.
- Traefik protects OpenCode Web UI with forward-auth.
- The bot can issue a browser access flow so the admin opens OpenCode safely from Telegram.

### Model and mode flow

- OpenCode discovers available models dynamically from CLIProxy `/v1/models` at container startup.
- Telegram mode selection is persisted in backend preferences.
- Backend requests override OpenCode prompt model/agent explicitly.
- The backend also syncs Telegram-selected model/agent into OpenCode config defaults so fresh Web UI sessions start with the same execution mode.

## Main modules

### Backend

The backend is the heart of the system. It provides:

- project discovery, activation, creation, cloning, and deletion;
- OpenCode session management and prompt dispatch;
- runtime event subscription and Telegram outbox generation;
- file, terminal, Git, and settings APIs for the Mini App;
- provider and CLIProxy account management;
- browser access token and auth flows for OpenCode Web UI.

Important areas:

- `services/backend/src/projects/` - project lifecycle, files, Git, terminal
- `services/backend/src/prompt/` - prompt orchestration into OpenCode
- `services/backend/src/open-code/` - OpenCode HTTP/SSE integration
- `services/backend/src/telegram/` - Telegram APIs, preferences, outbox bridge, provider settings
- `services/backend/src/proxy/` - CLIProxy account and mode management
- `services/backend/src/system/` - runtime services and operational endpoints

### Telegram bot

The bot is intentionally lightweight. It focuses on:

- receiving prompts and admin commands;
- opening Mini App and OpenCode access flows;
- processing callback buttons and inline keyboards;
- polling backend outbox and delivering messages reliably;
- driving user-facing controls such as `/mode`, `/sessions`, `/stop`, and browser access.

### Mini App

The Mini App provides a richer control plane for tasks that are awkward in plain chat:

- project switching;
- file browsing and uploads;
- Git operations and status;
- project file, terminal, and container inspection actions;
- provider/runtime/settings management;
- Kanban/task board, runtime details, and operational views.

### OpenCode runtime

The OpenCode container starts in server mode and is configured dynamically.
It is intentionally trusted as the remote admin-agent runtime: it has host Docker access, `/hostfs`, host PID namespace, and the `rvs-host` helper for server-level installs/configuration.

At startup, the entrypoint:

- loads the current CLIProxy model catalog;
- generates the managed provider block for `opencode.json`;
- preserves unrelated config sections;
- keeps auth/config state in persistent Docker volumes.

### CLIProxy integration

CLIProxy acts as the model gateway used by OpenCode. It allows the runtime to work with multiple upstream accounts/providers while exposing a single OpenAI-compatible surface.

## Repository layout

```text
.
├── services/
│   ├── backend/
│   ├── bot/
│   ├── miniapp/
│   └── opencode/
├── infra/
├── scripts/
├── docker-compose.yml
└── README.md
```

## Installation

### Recommended: image-only runtime install

The recommended production setup installs a runtime directory on the server without cloning the full repository there. The host receives only a runtime folder with `.env`, Compose files, and infrastructure config, while all services run from published Docker images.

Use a clean Ubuntu/Debian-compatible server when possible. The installer performs host-level setup and is designed for a dedicated remote runtime.

Use the bootstrap script:

```bash
curl -fsSL https://raw.githubusercontent.com/nyxandro/remote-vibe-station/master/scripts/bootstrap-runtime.sh | sudo bash -s -- \
  --bot-token "<TELEGRAM_BOT_TOKEN>" \
  --admin-id "<TELEGRAM_ADMIN_ID>" \
  --domain auto \
  --tls-email "<YOUR_EMAIL>"
```

You can also use your own domain:

```bash
curl -fsSL https://raw.githubusercontent.com/nyxandro/remote-vibe-station/master/scripts/bootstrap-runtime.sh | sudo bash -s -- \
  --bot-token "<TELEGRAM_BOT_TOKEN>" \
  --admin-id "<TELEGRAM_ADMIN_ID>" \
  --domain "example.com" \
  --tls-email "ops@example.com"
```

When `--domain auto` is used, the installer resolves the public IPv4 and builds domains like:

```text
<ip>.sslip.io
code.<ip>.sslip.io
```

### What gets installed and configured

The bootstrap script downloads only the runtime install assets and then runs `scripts/install-runtime.sh`.

The installer:

- installs baseline host packages such as `ca-certificates`, `curl`, `git`, `iproute2`, `jq`, `openssl`, `ufw`, and `fail2ban`;
- installs Docker if Docker is not already present;
- creates the runtime directory, by default `/opt/remote-vibe-station-runtime`;
- creates the projects root, by default `/srv/projects`;
- generates runtime secrets and writes `.env`;
- writes `docker-compose.yml`, `docker-compose.vless.yml`, Traefik config, CLIProxy config, and optional VLESS placeholders;
- configures Docker log rotation;
- enables SSH hardening in key-only mode when authorized SSH keys already exist on the host;
- opens `22`, `80`, and `443` in UFW;
- enables `fail2ban` for SSH;
- installs a systemd timer for Docker cleanup;
- runs preflight checks before bringing the stack up;
- pulls images and starts the runtime with Docker Compose.

The installer never copies project source code into the runtime directory.

### What the runtime contains

The generated runtime directory looks like this:

```text
/opt/remote-vibe-station-runtime/
├── .env
├── docker-compose.yml
├── docker-compose.vless.yml
├── runtime-maintenance.sh
└── infra/
    ├── cliproxy/config.yaml
    ├── traefik/traefik.yml
    ├── traefik/acme.json
    ├── traefik/dynamic/noindex.yml
    ├── traefik/dynamic/opencode-auth.yml
    └── vless/
        ├── proxy.env
        └── xray.json
```

Key runtime files:

- `/opt/remote-vibe-station-runtime/.env` - runtime secrets, versions, image refs, domains, and paths;
- `/opt/remote-vibe-station-runtime/docker-compose.yml` - the main image-only stack;
- `/opt/remote-vibe-station-runtime/docker-compose.vless.yml` - optional VLESS override;
- `/opt/remote-vibe-station-runtime/infra/` - Traefik, CLIProxy, and proxy-related config.

## Runtime requirements

At minimum you need:

- a Linux host with Docker support;
- a Telegram bot token;
- one or more Telegram admin IDs;
- a public domain, or `auto` for `sslip.io`-based setup;
- an email address for Let's Encrypt;
- network access for pulling GHCR images and reaching model/provider endpoints.

## Configuration

The runtime directory is typically:

```text
/opt/remote-vibe-station-runtime
```

Important files:

- `/opt/remote-vibe-station-runtime/.env` - runtime images, versions, and environment variables
- `/opt/remote-vibe-station-runtime/docker-compose.yml` - main Compose file
- `/opt/remote-vibe-station-runtime/docker-compose.vless.yml` - optional override for VLESS/proxy mode
- `/opt/remote-vibe-station-runtime/infra/` - Traefik, CLIProxy, and related configuration

Important runtime variables written by the installer include:

```text
COMPOSE_PROJECT_NAME=remote-vibe-station
TELEGRAM_BOT_TOKEN=<provided>
ADMIN_IDS=<provided>
PUBLIC_BASE_URL=https://<domain>
PUBLIC_DOMAIN=<domain>
OPENCODE_PUBLIC_BASE_URL=https://<opencode-domain>
OPENCODE_PUBLIC_DOMAIN=<opencode-domain>
PROJECTS_ROOT=/srv/projects
RVS_RUNTIME_VERSION=<display-version>
RVS_RUNTIME_IMAGE_TAG=<image-tag>
RVS_RUNTIME_COMMIT_SHA=<source-commit-sha>
BOT_BACKEND_AUTH_TOKEN=<generated>
OPENCODE_SERVER_PASSWORD=<generated>
CLIPROXY_API_KEY=<generated>
CLIPROXY_MANAGEMENT_PASSWORD=<generated>
RVS_BACKEND_IMAGE=<image>
RVS_MINIAPP_IMAGE=<image>
RVS_BOT_IMAGE=<image>
RVS_OPENCODE_IMAGE=<image>
RVS_CLIPROXY_IMAGE=<image>
```

`RVS_RUNTIME_VERSION` is the human-readable release version shown in the UI. `RVS_RUNTIME_IMAGE_TAG` is the actual Docker image tag used for deploys, for example `v0.2.1` or `sha-<commit>`.

Important note:

- this runtime directory is not a source checkout;
- services run from published Docker images;
- source-controlled code remains in the Git repository and CI/CD publishes the runtime images.

## Local development

Each service is developed independently.

### Backend

```bash
cd services/backend
npm install
npm run start:dev
```

### Bot

```bash
cd services/bot
npm install
npm run start:dev
```

### Mini App

```bash
cd services/miniapp
npm install
npm run dev
```

## Testing

Examples:

```bash
cd services/backend && npm test
cd services/backend && npm run typecheck

cd services/bot && npm test
cd services/bot && npm run typecheck

cd services/miniapp && npm test
```

The backend and bot contain focused tests for Telegram bridging, runtime orchestration, session control, and provider flows.

## Deployment model

This repository is designed around image-based deployment.

### CI/CD

In the standard runtime flow:

- pushes to `master` trigger image builds and publication to GHCR;
- stable runtime updates are discovered from GitHub Releases such as `v0.2.1`;
- the Mini App checks the latest release and offers `Update runtime` when a newer release exists;
- runtime updates save the previous `.env` as `.env.previous`, pull the new images, and restart the stack;
- `Rollback` restores the previous `.env` snapshot and reapplies Compose.

Relevant workflows:

- `.github/workflows/build-images.yml`
- `.github/workflows/deploy-runtime.yml`

`Deploy Runtime` is kept as a manual emergency workflow. The normal production path is image build + Mini App runtime update.

### Manual emergency rollout

If CI/CD is temporarily unavailable, you can refresh the runtime manually:

```bash
cd /opt/remote-vibe-station-runtime
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml pull
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml up -d --remove-orphans
```

### Runtime update flow in Mini App

The production update path is intentionally user-driven:

1. Open Mini App.
2. Go to `Settings -> Runtime updates`.
3. Press `Check`.
4. If a newer release exists, press `Update runtime`.
5. During restart the Mini App can briefly disconnect; it reconnects and shows persisted progress/state.
6. If the new release is broken, press `Rollback` to return to the previous runtime snapshot.

`Check` compares the current runtime version to the latest GitHub Release. It does not treat every `master` commit as a production update.

### VLESS and proxy runtime

Fresh installs keep VLESS disabled by default. The installer writes a no-op `docker-compose.vless.yml` and empty proxy config placeholders so the runtime does not start with fake credentials.

The intended flow is:

1. Open Mini App.
2. Go to Providers / CLIProxy runtime settings.
3. Switch to `vless` mode.
4. Paste the real `vless://...` config URL.
5. Test and save settings.
6. Apply runtime now.

The backend then rewrites the VLESS files and restarts the selected services with proxy routing.

### Verification after install or update

```bash
cd /opt/remote-vibe-station-runtime
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml ps
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml logs --tail=100 backend bot miniapp opencode cliproxy proxy
```

Expected URLs:

```text
https://<domain>/miniapp
https://<opencode-domain>
```

### Maintenance

The installer creates `runtime-maintenance.sh` and the systemd timer `remote-vibe-station-maintenance.timer`.

That maintenance job safely prunes:

- unused Docker images older than the configured window;
- stopped containers;
- unused networks;
- Docker build cache.

It does not delete Docker volumes.

### Stop or remove runtime

Stop the runtime without deleting data:

```bash
cd /opt/remote-vibe-station-runtime
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml stop
```

Remove containers without deleting named volumes:

```bash
cd /opt/remote-vibe-station-runtime
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml down
```

## Supported user workflows

- chat with OpenCode from Telegram;
- switch projects and sessions remotely;
- open OpenCode Web UI securely from Telegram;
- review tool progress, file updates, todos, and permission prompts in chat;
- configure model/provider/agent preferences;
- connect provider accounts and CLIProxy-backed model sources;
- manage project files, Git, and terminal access from the Mini App;
- operate voice-control flows for Telegram voice messages.

## Scripts and infrastructure

Important assets:

- `scripts/bootstrap-runtime.sh` - one-command bootstrap installer
- `scripts/install-runtime.sh` - main runtime installation script
- `scripts/install-runtime-preflight.sh` - host validation/preflight checks
- `scripts/templates/runtime-docker-compose.yml` - runtime Compose template
- `infra/traefik/traefik.yml` - Traefik base configuration
- `infra/traefik/dynamic/opencode-auth.yml` - OpenCode forward-auth middleware
- `infra/cliproxy/config.yaml` - CLIProxy configuration

## Operational notes

- Treat merges into `master` as deployment triggers.
- Prefer Docker Compose `stop`/`start` for dev/runtime operations when data persistence matters.
- Run database or runtime migrations inside the appropriate containers.
- Do not rely on local manual server builds from stale source trees; use published images from CI whenever possible.

## License

MIT
