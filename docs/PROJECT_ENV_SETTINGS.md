# Project Env Settings

Mini App `Settings -> 7. Настройки проекта` now supports automatic env-file discovery for the selected project.

## Discovery Rules

- Included patterns:
  - `.env`
  - `.env.*`
  - `*.env`
  - `*.env.*`
  - `.envrc`
- Ignored directories:
  - `.git`, `node_modules`, `.next`, `dist`, `build`, `.turbo`, `.cache`, `coverage`, `vendor`
- Safety limits:
  - max depth: 10
  - max files: 200

## Security Model

- UI receives discovered env file list via `GET /api/opencode/settings/overview` as `projectEnvFiles`.
- Read/save requests for `kind=projectEnvFile` are allowed only for paths that are in the discovered list.
- This prevents using the env endpoint for arbitrary file access.
