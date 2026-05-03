#!/usr/bin/env bash

set -euo pipefail

# One-shot production installer for image-only deployment.
# The installer intentionally avoids source-code checkout on the server.

DEFAULT_INSTALL_DIR="/opt/remote-vibe-station-runtime"
DEFAULT_PROJECTS_ROOT="/srv/projects"
DEFAULT_COMPOSE_PROJECT="remote-vibe-station"
DOCKER_LOG_MAX_SIZE="10m"
DOCKER_LOG_MAX_FILE="5"
DOCKER_PRUNE_RESERVED_SPACE="512MB"
DOCKER_IMAGE_PRUNE_UNTIL="168h"

usage() {
  cat <<'EOF'
Usage:
  install-runtime.sh --bot-token <token> --admin-id <id> --domain <domain|auto> --tls-email <email> [options]

Required:
  --bot-token <token>        Telegram BotFather token
  --admin-id <id>            Telegram admin user id
  --domain <domain|auto>     Public base domain or auto -> <server-ip>.sslip.io
  --tls-email <email>        Let's Encrypt contact email

Optional:
  --install-dir <path>       Runtime directory (default: /opt/remote-vibe-station-runtime)
  --projects-root <path>     Host projects root mounted into containers (default: /srv/projects)
  --miniapp-short-name <id>  Telegram Mini App short name
  --opencode-domain <domain> OpenCode UI domain (default: code.<domain>)
  --runtime-version <value>  Installed runtime version label (default: image tag without leading v)
  --runtime-commit-sha <sha> Installed source commit SHA label
  --image-tag <tag>          Use one tag for all RVS service images
  --backend-image <image>    Backend image reference
  --miniapp-image <image>    Mini App image reference
  --bot-image <image>        Bot image reference
  --opencode-image <image>   OpenCode image reference
  --cliproxy-image <image>   CLIProxyAPI image reference
  --github-token <token>     Optional GitHub token for non-interactive gh auth
  --skip-preflight           Skip DNS/ports/compose preflight checks
  --dry-run                  Generate files only, skip package/firewall/docker actions
  --help                     Show this help
EOF
}

random_alnum() {
  # Generate deterministic-length hex tokens for secrets.
  local length="$1"
  local bytes=$(( (length + 1) / 2 ))
  openssl rand -hex "$bytes" | cut -c1-"$length"
}

detect_public_ipv4() {
  # Resolve host public IPv4 for auto-domain mode.
  local ip=""
  ip="$(curl -fsS --max-time 5 https://api.ipify.org || true)"
  if [[ -z "$ip" ]]; then
    ip="$(curl -fsS --max-time 5 https://ipv4.icanhazip.com 2>/dev/null | tr -d '\n' || true)"
  fi
  if [[ ! "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo ""
    return
  fi
  echo "$ip"
}

write_file() {
  # Write files atomically to avoid partial writes on interrupted setup.
  local target="$1"
  local tmp="${target}.tmp"
  cat >"$tmp"
  mv "$tmp" "$target"
}

# Load larger host-management helpers from the bootstrap-downloaded installer bundle.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/runtime-installer-lib.sh"

generate_runtime_files() {
  # Materialize complete runtime stack layout in install directory.
  mkdir -p "$INSTALL_DIR/infra/traefik/dynamic"
  mkdir -p "$INSTALL_DIR/infra/cliproxy"
  mkdir -p "$INSTALL_DIR/infra/vless"
  mkdir -p "$PROJECTS_ROOT"

  # ACME state must remain private because it contains certificate account data.
  if [[ ! -f "$INSTALL_DIR/infra/traefik/acme.json" ]]; then
    : >"$INSTALL_DIR/infra/traefik/acme.json"
  fi
  chmod 600 "$INSTALL_DIR/infra/traefik/acme.json"

  write_file "$INSTALL_DIR/infra/traefik/traefik.yml" <<EOF
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

certificatesResolvers:
  le:
    acme:
      email: "${TLS_EMAIL}"
      storage: /acme/acme.json
      httpChallenge:
        entryPoint: web

providers:
  docker:
    exposedByDefault: false
  file:
    directory: /etc/traefik/dynamic
    watch: true
EOF

  write_file "$INSTALL_DIR/infra/traefik/dynamic/noindex.yml" <<'EOF'
http:
  middlewares:
    noindex-headers:
      headers:
        customResponseHeaders:
          X-Robots-Tag: "noindex, nofollow, noarchive"
EOF

  write_file "$INSTALL_DIR/infra/traefik/dynamic/opencode-auth.yml" <<'EOF'
http:
  middlewares:
    opencode-forward-auth:
      forwardAuth:
        address: "http://bot:3001/opencode-auth/check"
        trustForwardHeader: false
        authResponseHeaders:
          - "X-Auth-Admin-ID"
EOF

  write_file "$INSTALL_DIR/infra/cliproxy/config.yaml" <<EOF
# Runtime-generated CLIProxyAPI config.
request-log: false
request-retry: 2
port: 8317
auth-dir: "~/.cli-proxy-api"
api-keys:
  - ${CLIPROXY_API_KEY}
EOF

  # Keep runtime compose template in repository and copy it into install directory.
  cp "$(dirname "${BASH_SOURCE[0]}")/templates/runtime-docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
  cp "$(dirname "${BASH_SOURCE[0]}")/templates/runtime-docker-compose.vless.yml" "$INSTALL_DIR/docker-compose.vless.yml"
  cp "$(dirname "${BASH_SOURCE[0]}")/templates/vless-proxy.env" "$INSTALL_DIR/infra/vless/proxy.env"
  cp "$(dirname "${BASH_SOURCE[0]}")/templates/vless-xray.json" "$INSTALL_DIR/infra/vless/xray.json"

  write_file "$INSTALL_DIR/runtime-maintenance.sh" <<EOF
#!/usr/bin/env bash

set -euo pipefail

# Reclaim safe Docker garbage without touching named volumes or the newest rollback images.
docker image prune -af --filter "until=${DOCKER_IMAGE_PRUNE_UNTIL}"
docker container prune -f
docker network prune -f

# Older Docker releases may not support --reserved-space, so fall back gracefully.
BUILDER_PRUNE_BASE=(docker builder prune -af)
if docker builder prune --help 2>/dev/null | grep -q -- '--reserved-space'; then
  BUILDER_PRUNE_BASE+=(--reserved-space ${DOCKER_PRUNE_RESERVED_SPACE})
fi
"\${BUILDER_PRUNE_BASE[@]}"
EOF
  chmod +x "$INSTALL_DIR/runtime-maintenance.sh"

  write_file "$INSTALL_DIR/.env" <<EOF
COMPOSE_PROJECT_NAME=${DEFAULT_COMPOSE_PROJECT}
TELEGRAM_BOT_TOKEN=${BOT_TOKEN}
TELEGRAM_MINIAPP_SHORT_NAME=${MINIAPP_SHORT_NAME}
ADMIN_IDS=${ADMIN_ID}
PUBLIC_BASE_URL=https://${DOMAIN}
PUBLIC_DOMAIN=${DOMAIN}
OPENCODE_PUBLIC_BASE_URL=https://${OPENCODE_DOMAIN}
OPENCODE_PUBLIC_DOMAIN=${OPENCODE_DOMAIN}
TLS_EMAIL=${TLS_EMAIL}
PROJECTS_ROOT=${PROJECTS_ROOT}
RVS_RUNTIME_VERSION=${RUNTIME_VERSION}
RVS_RUNTIME_IMAGE_TAG=${IMAGE_TAG}
RVS_RUNTIME_COMMIT_SHA=${RUNTIME_COMMIT_SHA}
BOT_BACKEND_AUTH_TOKEN=${BOT_BACKEND_AUTH_TOKEN}
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=${OPENCODE_SERVER_PASSWORD}
CLIPROXY_PROVIDER_ID=cliproxy
CLIPROXY_PROVIDER_NAME=CLIProxy
CLIPROXY_API_KEY=${CLIPROXY_API_KEY}
CLIPROXY_DEFAULT_MODEL_ID=
CLIPROXY_MANAGEMENT_PASSWORD=${CLIPROXY_MANAGEMENT_PASSWORD}
RVS_BACKEND_IMAGE=${BACKEND_IMAGE}
RVS_MINIAPP_IMAGE=${MINIAPP_IMAGE}
RVS_BOT_IMAGE=${BOT_IMAGE}
RVS_OPENCODE_IMAGE=${OPENCODE_IMAGE}
RVS_CLIPROXY_IMAGE=${CLIPROXY_IMAGE}
EOF
}

start_stack() {
  # Always include the optional VLESS override so saved proxy routing survives every deploy.
  pushd "$INSTALL_DIR" >/dev/null
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml pull
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml up -d --remove-orphans
  popd >/dev/null
}
BOT_TOKEN=""
ADMIN_ID=""
DOMAIN=""
TLS_EMAIL=""
MINIAPP_SHORT_NAME=""
INSTALL_DIR="$DEFAULT_INSTALL_DIR"
PROJECTS_ROOT="$DEFAULT_PROJECTS_ROOT"
DRY_RUN="false"
GITHUB_TOKEN=""
SKIP_PREFLIGHT="false"
IMAGE_TAG="latest"
RUNTIME_VERSION_PROVIDED="false"
RUNTIME_VERSION=""
RUNTIME_COMMIT_SHA=""
# Default image references can be overridden via flags during installation.
BACKEND_IMAGE=""
MINIAPP_IMAGE=""
BOT_IMAGE=""
OPENCODE_IMAGE=""
CLIPROXY_IMAGE="eceasy/cli-proxy-api:latest"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bot-token)
      BOT_TOKEN="$2"
      shift 2
      ;;
    --admin-id)
      ADMIN_ID="$2"
      shift 2
      ;;
    --domain)
      DOMAIN="$2"
      shift 2
      ;;
    --tls-email)
      TLS_EMAIL="$2"
      shift 2
      ;;
    --miniapp-short-name)
      MINIAPP_SHORT_NAME="$2"
      shift 2
      ;;
    --opencode-domain)
      OPENCODE_DOMAIN="$2"
      shift 2
      ;;
    --runtime-version)
      RUNTIME_VERSION="$2"
      RUNTIME_VERSION_PROVIDED="true"
      shift 2
      ;;
    --runtime-commit-sha)
      RUNTIME_COMMIT_SHA="$2"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --projects-root)
      PROJECTS_ROOT="$2"
      shift 2
      ;;
    --backend-image)
      BACKEND_IMAGE="$2"
      shift 2
      ;;
    --miniapp-image)
      MINIAPP_IMAGE="$2"
      shift 2
      ;;
    --bot-image)
      BOT_IMAGE="$2"
      shift 2
      ;;
    --opencode-image)
      OPENCODE_IMAGE="$2"
      shift 2
      ;;
    --cliproxy-image)
      CLIPROXY_IMAGE="$2"
      shift 2
      ;;
    --github-token)
      GITHUB_TOKEN="$2"
      shift 2
      ;;
    --skip-preflight)
      SKIP_PREFLIGHT="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
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

if [[ -z "$BOT_TOKEN" || -z "$ADMIN_ID" || -z "$DOMAIN" || -z "$TLS_EMAIL" ]]; then
  echo "ERROR: --bot-token, --admin-id, --domain and --tls-email are required" >&2
  usage
  exit 1
fi

if [[ "$DOMAIN" == "auto" ]]; then
  AUTO_IP="$(detect_public_ipv4)"
  if [[ -z "$AUTO_IP" ]]; then
    echo "ERROR: failed to resolve public IPv4 for --domain auto" >&2
    exit 1
  fi
  DOMAIN="${AUTO_IP}.sslip.io"
  if [[ -z "${OPENCODE_DOMAIN:-}" ]]; then
    OPENCODE_DOMAIN="code.${DOMAIN}"
  fi
fi

if [[ -z "${OPENCODE_DOMAIN:-}" ]]; then
  OPENCODE_DOMAIN="code.${DOMAIN}"
fi
if [[ -z "$BACKEND_IMAGE" ]]; then
  BACKEND_IMAGE="ghcr.io/nyxandro/remote-vibe-station-backend:${IMAGE_TAG}"
fi
if [[ -z "$MINIAPP_IMAGE" ]]; then
  MINIAPP_IMAGE="ghcr.io/nyxandro/remote-vibe-station-miniapp:${IMAGE_TAG}"
fi
if [[ -z "$BOT_IMAGE" ]]; then
  BOT_IMAGE="ghcr.io/nyxandro/remote-vibe-station-bot:${IMAGE_TAG}"
fi
if [[ -z "$OPENCODE_IMAGE" ]]; then
  OPENCODE_IMAGE="ghcr.io/nyxandro/remote-vibe-station-opencode:${IMAGE_TAG}"
fi
# Keep dry-run self-contained to avoid writing into privileged host paths.
if [[ "$DRY_RUN" == "true" ]]; then
  PROJECTS_ROOT="$INSTALL_DIR/projects"
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: required command not found: openssl" >&2
  exit 1
fi
# Enforce root before touching system directories in full install mode.
if [[ "$DRY_RUN" != "true" ]]; then
  ensure_root
fi
# Preserve existing runtime secrets on reinstall so public sessions and service auth stay stable.
if [[ -f "$INSTALL_DIR/.env" ]]; then
  set -a
  source "$INSTALL_DIR/.env"
  set +a
fi
if [[ "$RUNTIME_VERSION_PROVIDED" != "true" && -n "${RVS_RUNTIME_VERSION:-}" ]]; then
  RUNTIME_VERSION="$RVS_RUNTIME_VERSION"
fi
if [[ -z "$RUNTIME_VERSION" ]]; then
  RUNTIME_VERSION="${IMAGE_TAG#v}"
fi
BOT_BACKEND_AUTH_TOKEN="${BOT_BACKEND_AUTH_TOKEN:-rvs-bot-$(random_alnum 56)}"
OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD:-$(random_alnum 48)}"
CLIPROXY_MANAGEMENT_PASSWORD="${CLIPROXY_MANAGEMENT_PASSWORD:-$(random_alnum 48)}"
CLIPROXY_API_KEY="${CLIPROXY_API_KEY:-sk-cliproxy-$(random_alnum 56)}"
RUNTIME_COMMIT_SHA="${RUNTIME_COMMIT_SHA:-${RVS_RUNTIME_COMMIT_SHA:-}}"
generate_runtime_files
if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run complete. Files generated in: $INSTALL_DIR"
  exit 0
fi
install_system_dependencies
install_github_cli_if_possible
install_docker_if_missing
configure_docker_daemon
systemctl enable docker >/dev/null 2>&1 || true
systemctl restart docker
authenticate_github_cli
# Validate runtime prerequisites before firewall changes and compose startup.
if [[ "$SKIP_PREFLIGHT" != "true" ]]; then
  "$(dirname "${BASH_SOURCE[0]}")/install-runtime-preflight.sh" --install-dir "$INSTALL_DIR" --domain "$DOMAIN" --opencode-domain "$OPENCODE_DOMAIN" --projects-root "$PROJECTS_ROOT"
fi
configure_sshd_key_only
configure_ufw
configure_fail2ban
install_runtime_maintenance_timer
start_stack
run_runtime_maintenance_now
echo "Install completed. Runtime directory: $INSTALL_DIR"
echo "Mini App URL: https://${DOMAIN}/miniapp | OpenCode URL: https://${OPENCODE_DOMAIN}"
