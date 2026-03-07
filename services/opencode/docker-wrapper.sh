#!/usr/bin/env sh

set -eu

# Debian's docker.io package ships legacy docker-compose as a standalone binary.
# OpenCode agents commonly call `docker compose`, so normalize that form here.
case "${1:-}" in
  compose)
    shift
    exec /usr/bin/docker-compose "$@"
    ;;
esac

exec /usr/bin/docker "$@"
