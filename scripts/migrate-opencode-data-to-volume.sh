#!/usr/bin/env bash

set -euo pipefail

##
# Migrate legacy host OpenCode state directory into the Docker named volume.
#
# Why:
# - Older compose configs bind-mounted ./opencode-data into OpenCode.
# - Current config uses named volume `opencode_data` for portability.
# - This script copies the directory contents into the correct volume.
#
# Usage:
#   COMPOSE_PROJECT_NAME=remote-vibe-station ./scripts/migrate-opencode-data-to-volume.sh ./opencode-data
##

SRC_DIR="${1:-}"
if [[ -z "$SRC_DIR" ]]; then
  echo "ERROR: source directory argument is required" >&2
  echo "Usage: COMPOSE_PROJECT_NAME=<name> $0 <path-to-opencode-data>" >&2
  exit 1
fi

if [[ -z "${COMPOSE_PROJECT_NAME:-}" ]]; then
  echo "ERROR: COMPOSE_PROJECT_NAME is required to compute the volume name" >&2
  exit 1
fi

if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: source directory not found: $SRC_DIR" >&2
  exit 1
fi

VOLUME_NAME="${COMPOSE_PROJECT_NAME}_opencode_data"

echo "Source: $SRC_DIR"
echo "Volume: $VOLUME_NAME"

if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  echo "Creating volume: $VOLUME_NAME"
  docker volume create "$VOLUME_NAME" >/dev/null
fi

echo "Copying data into volume..."
docker run --rm \
  -v "$VOLUME_NAME":/dst \
  -v "$(cd "$SRC_DIR" && pwd)":/src:ro \
  alpine:3.20 \
  sh -c 'cp -a /src/. /dst/'

echo "Done. You can now start the stack (docker compose up -d)."
