#!/usr/bin/env bash

set -euo pipefail

# Preflight checks for runtime installer.

usage() {
  cat <<'EOF'
Usage:
  install-runtime-preflight.sh --install-dir <path> --domain <domain> --opencode-domain <domain> --projects-root <path>
EOF
}

require_arg() {
  # Enforce explicit required arguments to keep checks deterministic.
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "ERROR: missing required argument: $name" >&2
    exit 1
  fi
}

check_path_writable() {
  # Ensure installer can create runtime and projects directories.
  local target="$1"
  mkdir -p "$target"
  if [[ ! -w "$target" ]]; then
    echo "ERROR: path is not writable: $target" >&2
    exit 1
  fi
}

check_domain_resolves() {
  # Fail fast when DNS records are absent.
  local domain="$1"
  if ! getent ahostsv4 "$domain" >/dev/null 2>&1; then
    echo "ERROR: domain does not resolve to IPv4: $domain" >&2
    exit 1
  fi
}

check_domain_points_to_host() {
  # Compare domain A-record against current server public IPv4.
  local domain="$1"
  local public_ip=""
  public_ip="$(curl -fsS --max-time 5 https://api.ipify.org || true)"
  if [[ -z "$public_ip" ]]; then
    public_ip="$(curl -fsS --max-time 5 https://ipv4.icanhazip.com 2>/dev/null | tr -d '\n' || true)"
  fi

  if [[ -z "$public_ip" ]]; then
    echo "WARN: cannot detect public IP, skipping DNS-to-host match for $domain" >&2
    return
  fi

  if ! getent ahostsv4 "$domain" | awk '{print $1}' | grep -qx "$public_ip"; then
    echo "ERROR: domain $domain does not point to this server IP ($public_ip)" >&2
    exit 1
  fi
}

check_ports_free() {
  # Prevent startup failure when another process already listens on 80/443.
  if ss -ltn | grep -qE 'LISTEN.+:80\s'; then
    echo "ERROR: TCP port 80 is already in use" >&2
    exit 1
  fi
  if ss -ltn | grep -qE 'LISTEN.+:443\s'; then
    echo "ERROR: TCP port 443 is already in use" >&2
    exit 1
  fi
}

check_compose_valid() {
  # Validate base runtime plus the generated VLESS override exactly like the real deploy path.
  local install_dir="$1"
  docker compose \
    --env-file "$install_dir/.env" \
    -f "$install_dir/docker-compose.yml" \
    -f "$install_dir/docker-compose.vless.yml" \
    config >/dev/null
}

INSTALL_DIR=""
DOMAIN=""
OPENCODE_DOMAIN=""
PROJECTS_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --domain)
      DOMAIN="$2"
      shift 2
      ;;
    --opencode-domain)
      OPENCODE_DOMAIN="$2"
      shift 2
      ;;
    --projects-root)
      PROJECTS_ROOT="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_arg "--install-dir" "$INSTALL_DIR"
require_arg "--domain" "$DOMAIN"
require_arg "--opencode-domain" "$OPENCODE_DOMAIN"
require_arg "--projects-root" "$PROJECTS_ROOT"

check_path_writable "$INSTALL_DIR"
check_path_writable "$PROJECTS_ROOT"
check_domain_resolves "$DOMAIN"
check_domain_resolves "$OPENCODE_DOMAIN"
check_domain_points_to_host "$DOMAIN"
check_domain_points_to_host "$OPENCODE_DOMAIN"
check_ports_free
check_compose_valid "$INSTALL_DIR"

echo "Preflight checks passed"
