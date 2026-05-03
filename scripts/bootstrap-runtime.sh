#!/usr/bin/env bash

set -euo pipefail

# One-command bootstrap entrypoint for open-source installation UX.
# This script downloads installer assets to a temp directory and runs them.

DEFAULT_REPO="nyxandro/remote-vibe-station"
DEFAULT_REF="master"

usage() {
  cat <<'EOF'
Usage:
  bootstrap-runtime.sh [--repo owner/repo] [--ref branch-or-tag] -- <install-runtime args>

Examples:
  curl -fsSL https://raw.githubusercontent.com/nyxandro/remote-vibe-station/master/scripts/bootstrap-runtime.sh | sudo bash -s -- --bot-token "..." --admin-id "..." --domain auto --tls-email "ops@example.com"

  curl -fsSL https://raw.githubusercontent.com/nyxandro/remote-vibe-station/master/scripts/bootstrap-runtime.sh | sudo bash -s -- --ref develop -- --bot-token "..." --admin-id "..." --domain auto --tls-email "ops@example.com"
EOF
}

download_file() {
  # Download a single installer asset from raw.githubusercontent.
  local repo="$1"
  local ref="$2"
  local source_path="$3"
  local target_path="$4"
  local url="https://raw.githubusercontent.com/${repo}/${ref}/${source_path}"
  curl -fsSL "$url" -o "$target_path"
}

REPO="$DEFAULT_REPO"
REF="$DEFAULT_REF"
INSTALL_ARGS=()

# Parse bootstrap flags first, then pass the rest directly to install-runtime.sh.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="$2"
      shift 2
      ;;
    --ref)
      REF="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    --)
      shift
      INSTALL_ARGS=("$@")
      break
      ;;
    *)
      INSTALL_ARGS+=("$1")
      shift
      ;;
  esac
done

# Keep bootstrap artifacts ephemeral; runtime installer writes final files to /opt.
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$WORK_DIR/templates"

# Fetch required installer components that install-runtime.sh expects nearby.
download_file "$REPO" "$REF" "scripts/install-runtime.sh" "$WORK_DIR/install-runtime.sh"
download_file "$REPO" "$REF" "scripts/install-runtime-preflight.sh" "$WORK_DIR/install-runtime-preflight.sh"
download_file "$REPO" "$REF" "scripts/runtime-installer-lib.sh" "$WORK_DIR/runtime-installer-lib.sh"
download_file "$REPO" "$REF" "scripts/templates/runtime-docker-compose.yml" "$WORK_DIR/templates/runtime-docker-compose.yml"
download_file "$REPO" "$REF" "scripts/templates/runtime-docker-compose.vless.yml" "$WORK_DIR/templates/runtime-docker-compose.vless.yml"
download_file "$REPO" "$REF" "scripts/templates/vless-proxy.env" "$WORK_DIR/templates/vless-proxy.env"
download_file "$REPO" "$REF" "scripts/templates/vless-xray.json" "$WORK_DIR/templates/vless-xray.json"

chmod +x "$WORK_DIR/install-runtime.sh" "$WORK_DIR/install-runtime-preflight.sh"

# Execute real installer with caller-provided arguments unchanged.
exec "$WORK_DIR/install-runtime.sh" "${INSTALL_ARGS[@]}"
