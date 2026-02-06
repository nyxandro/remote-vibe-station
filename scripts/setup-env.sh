#!/usr/bin/env bash

# Purpose:
# - Generate a .env from .env.example
# - Optionally set PROJECTS_ROOT and OPENCODE_DATA_DIR to sane defaults
#   relative to the current user's home directory.
#
# Why this script exists:
# - docker-compose env substitution happens before containers start.
# - The stack needs explicit host paths for bind mounts.
# - We want an install-time toggle for default vs custom paths.

set -euo pipefail

ENV_EXAMPLE_FILE=".env.example"
ENV_FILE=".env"

if [[ ! -f "$ENV_EXAMPLE_FILE" ]]; then
  echo "ERROR: $ENV_EXAMPLE_FILE not found" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE already exists (refusing to overwrite)" >&2
  exit 1
fi

cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"

# Read toggle from the freshly copied .env (default true if missing).
USE_DEFAULT_PATHS_VALUE="true"
if grep -q '^USE_DEFAULT_PATHS=' "$ENV_FILE"; then
  USE_DEFAULT_PATHS_VALUE="$(grep '^USE_DEFAULT_PATHS=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)"
fi

case "${USE_DEFAULT_PATHS_VALUE,,}" in
  true|1|yes)
    # Use HOME from the machine running the script (host), not container.
    DEFAULT_PROJECTS_ROOT="${HOME}/projects"
    DEFAULT_OPENCODE_DATA_DIR="${HOME}/opencode-data"

    # Create dirs only if missing; never touch existing project contents.
    if [[ ! -d "$DEFAULT_PROJECTS_ROOT" ]]; then
      mkdir -p "$DEFAULT_PROJECTS_ROOT"
    fi
    if [[ ! -d "$DEFAULT_OPENCODE_DATA_DIR" ]]; then
      mkdir -p "$DEFAULT_OPENCODE_DATA_DIR"
    fi

    # Replace values in .env. We keep simple KEY=VALUE lines.
    # shellcheck disable=SC2001
    sed -i "s#^PROJECTS_ROOT=.*#PROJECTS_ROOT=${DEFAULT_PROJECTS_ROOT}#" "$ENV_FILE"
    sed -i "s#^OPENCODE_DATA_DIR=.*#OPENCODE_DATA_DIR=${DEFAULT_OPENCODE_DATA_DIR}#" "$ENV_FILE"

    echo "OK: Created $ENV_FILE with defaults:"
    echo "- PROJECTS_ROOT=${DEFAULT_PROJECTS_ROOT}"
    echo "- OPENCODE_DATA_DIR=${DEFAULT_OPENCODE_DATA_DIR}"
    ;;
  false|0|no)
    # User will fill paths manually.
    echo "OK: Created $ENV_FILE. Fill PROJECTS_ROOT and OPENCODE_DATA_DIR manually."
    ;;
  *)
    echo "ERROR: USE_DEFAULT_PATHS must be true/false (got: $USE_DEFAULT_PATHS_VALUE)" >&2
    exit 1
    ;;
esac
