# Data Storage (Backend `data/`)

This project persists backend runtime state into a Docker volume mounted at `/app/data`.
The goal is reliability across restarts without allowing files to grow unbounded.

OpenCode server state is stored in a separate named volume (`opencode_data`) and is not part of backend `data/`.

## What Is Stored

Backend writes JSON files under `data/` (relative to backend working directory):

- `telegram.outbox.json` - durable Telegram delivery outbox (pending/delivered/dead).
- `telegram.preferences.json` - per-admin UI/agent/model preferences.
- `telegram.diff-previews.json` - short-lived diff preview cache for the Mini App.
- `telegram.stream.json` - per-admin chat binding and stream toggle state.
- `active-project.json` - selected project slug (per-admin + global fallback).
- `projects.state.json` - derived runtime status by project slug.
- `projects.json` - explicit project registry entries (created via register flow).
- `runtime-overrides/*.docker.override.json` - generated docker deploy overrides per project slug.
- `runtime-overrides/*.static.compose.json` - generated static deploy compose files per project slug.

## JSON Storage Policy

All backend JSON stores now use the same persistence rules:

- Writes are atomic (`*.tmp` -> rename) to reduce partial-write corruption.
- Corrupted recoverable files are moved aside as `*.corrupt-<timestamp>` before the app continues.
- Recovery is used only for operational/cache-like stores where reset is acceptable:
  - `telegram.outbox.json`
  - `telegram.prompt-queue.json`
  - `telegram.stream.json`
  - `telegram.preferences.json`
  - `telegram.diff-previews.json`
  - `active-project.json`
  - `projects.state.json`
  - `github.token.json`
- Strict fail-fast parsing is used for authoritative/business settings stores:
  - `projects.json`
  - `project-runtime.settings.json`
  - `proxy.settings.json`
  - `kanban.tasks.json`

This keeps operator-facing settings durable and explicit, while allowing transient UX/runtime state to self-heal after malformed writes.

## Retention / Cleanup

The backend runs a best-effort periodic maintenance job (`DataMaintenanceService`) that:

- Caps `telegram.outbox.json` growth:
  - keeps a bounded number of delivered messages;
  - prunes dead-letter messages by age and count.
- Prunes `telegram.diff-previews.json`:
  - drops stale records by TTL;
  - caps record count;
  - truncates very large diff payloads to protect disk.
- Keeps per-admin stores bounded to configured `ADMIN_IDS`:
  - `telegram.preferences.json`, `telegram.stream.json`, `active-project.json`.
- Removes derived data for projects that no longer exist on disk:
  - prunes unknown slugs from `projects.state.json`;
  - runtime override cleanup/regeneration is handled by backend deploy endpoints:
    - `POST /api/projects/:id/deploy/start` rewrites `data/runtime-overrides/*.json` before `docker compose up -d`;
    - `POST /api/projects/:id/deploy/stop` uses the same generated files for `docker compose stop`.
- Removes stale registry entries pointing to missing project folders:
  - prunes missing roots from `projects.json`.

Notes:

- Cleanup is intentionally best-effort: it must never crash the backend.
- If you change `PROJECTS_ROOT` or `ADMIN_IDS`, the next cleanup run will reconcile stored files.
