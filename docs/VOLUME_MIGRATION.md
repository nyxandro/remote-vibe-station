# Volume Migration Notes

This repository uses Docker named volumes to persist runtime state:

- `backend_data` - backend `/app/data`
- `opencode_data` - OpenCode `/root/.local/share/opencode` (projects/sessions/messages/logs)
- `opencode_config` - OpenCode config (`/root/.config/opencode`) shared with backend as `/opencode-config`

## Why

Named volumes are cross-platform (Windows/macOS/Linux) and avoid creating state folders in the repository.

## Migrating From Legacy Host Folders

Older setups used host bind mounts like `./opencode-data` (and sometimes `./data`).
If you have an existing `opencode-data` folder you want to keep, migrate it into the `opencode_data` volume.

### 1) Stop the stack

```bash
docker compose -f docker-compose.dev.yml down
```

### 2) Run migration script

```bash
COMPOSE_PROJECT_NAME=remote-vibe-station \
  ./scripts/migrate-opencode-data-to-volume.sh ./opencode-data
```

Notes:

- The script does not delete the source folder.
- The volume name is computed as `${COMPOSE_PROJECT_NAME}_opencode_data`.

### 3) Start the stack

```bash
docker compose -f docker-compose.dev.yml up -d
```

## Rollback

To rollback to bind mounts, you must revert the compose volume configuration and point OpenCode back to a host directory.
