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

ensure_root() {
  # Package install, firewall setup and docker management require root privileges.
  if [[ "${EUID}" -ne 0 ]]; then
    echo "ERROR: run as root (sudo)" >&2
    exit 1
  fi
}

install_system_dependencies() {
  # Install baseline tooling for secure dockerized runtime management.
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gh \
    jq \
    openssl \
    ufw \
    fail2ban
}

authenticate_github_cli() {
  # Configure gh non-interactively when token is provided by operator.
  if [[ -z "$GITHUB_TOKEN" ]]; then
    return
  fi
  gh auth login --hostname github.com --with-token <<<"$GITHUB_TOKEN"
}

install_docker_if_missing() {
  # Install Docker engine only when not already available on the host.
  if command -v docker >/dev/null 2>&1; then
    return
  fi

  curl -fsSL https://get.docker.com | sh
}

configure_ufw() {
  # Restrict inbound traffic to SSH + HTTP(S) while sshd itself allows only key-based logins.
  if ! ufw status | grep -q "Status: active"; then
    ufw --force default deny incoming
    ufw --force default allow outgoing
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
    return
  fi

  if ! ufw status | grep -qE '^22/tcp'; then
    ufw allow 22/tcp
  fi
  if ! ufw status | grep -qE '^80/tcp'; then
    ufw allow 80/tcp
  fi
  if ! ufw status | grep -qE '^443/tcp'; then
    ufw allow 443/tcp
  fi
}

configure_sshd_key_only() {
  # Key-only SSH avoids dynamic-IP lockouts while still blocking password brute force entirely.
  if ! has_any_authorized_ssh_key; then
    echo "WARNING: no authorized SSH keys found; keeping current sshd auth settings unchanged" >&2
    return
  fi

  mkdir -p /etc/ssh/sshd_config.d
  write_file /etc/ssh/sshd_config.d/99-remote-vibe-station.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
EOF

  sshd -t
  systemctl reload ssh
}

has_any_authorized_ssh_key() {
  # Enforce key-only SSH only when the server already has at least one usable authorized key.
  local key_files=(
    /root/.ssh/authorized_keys
    /home/*/.ssh/authorized_keys
  )

  local file
  for file in "${key_files[@]}"; do
    if [[ -f "$file" ]] && grep -q '^[[:space:]]*[^#[:space:]]' "$file"; then
      return 0
    fi
  done

  return 1
}

configure_fail2ban() {
  # Enable SSH ban policy to reduce automated scanning and password spray risk.
  mkdir -p /etc/fail2ban/jail.d
  write_file /etc/fail2ban/jail.d/remote-vibe-station.local <<'EOF'
[sshd]
enabled = true
port = ssh
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF

  systemctl enable fail2ban >/dev/null 2>&1 || true
  systemctl restart fail2ban
}

configure_docker_daemon() {
  # Apply host-wide log rotation defaults so ad-hoc containers cannot grow unbounded logs.
  mkdir -p /etc/docker
  local daemon_path="/etc/docker/daemon.json"
  local merged_json=""

  if [[ -f "$daemon_path" ]]; then
    cp "$daemon_path" "${daemon_path}.bak"
    if ! command -v jq >/dev/null 2>&1; then
      echo "WARNING: jq is required to merge $daemon_path safely; keeping existing Docker daemon config unchanged" >&2
      return
    fi

    if ! merged_json="$(jq \
      --arg maxSize "$DOCKER_LOG_MAX_SIZE" \
      --arg maxFile "$DOCKER_LOG_MAX_FILE" \
      '. + {
        "log-driver": "json-file",
        "log-opts": ((.["log-opts"] // {}) + {
          "max-size": $maxSize,
          "max-file": $maxFile
        })
      }' \
      "$daemon_path")"; then
      echo "ERROR: existing $daemon_path is not valid JSON" >&2
      return 1
    fi

    printf '%s\n' "$merged_json" | write_file "$daemon_path"
    return
  fi

  write_file "$daemon_path" <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "${DOCKER_LOG_MAX_SIZE}",
    "max-file": "${DOCKER_LOG_MAX_FILE}"
  }
}
EOF
}

generate_runtime_files() {
  # Materialize complete runtime stack layout in install directory.
  mkdir -p "$INSTALL_DIR/infra/traefik/dynamic"
  mkdir -p "$INSTALL_DIR/infra/cliproxy"
  mkdir -p "$INSTALL_DIR/infra/vless"
  mkdir -p "$PROJECTS_ROOT"

  # ACME state must remain private because it contains certificate account data.
  : >"$INSTALL_DIR/infra/traefik/acme.json"
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
"${BUILDER_PRUNE_BASE[@]}"
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

install_runtime_maintenance_timer() {
  # Run Docker garbage collection daily so repeated deploys do not fill the server disk.
  write_file /etc/systemd/system/remote-vibe-station-maintenance.service <<EOF
[Unit]
Description=Remote Vibe Station Docker maintenance
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=${INSTALL_DIR}/runtime-maintenance.sh
EOF

  write_file /etc/systemd/system/remote-vibe-station-maintenance.timer <<'EOF'
[Unit]
Description=Run Remote Vibe Station Docker maintenance daily

[Timer]
OnCalendar=*-*-* 04:25:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now remote-vibe-station-maintenance.timer >/dev/null 2>&1
}

run_runtime_maintenance_now() {
  # Prune unused images right after a successful deploy while old images are no longer referenced.
  "$INSTALL_DIR/runtime-maintenance.sh"
}

start_stack() {
  # Pull immutable runtime images and start services in detached mode.
  pushd "$INSTALL_DIR" >/dev/null
docker compose --env-file .env pull
  docker compose --env-file .env up -d --remove-orphans
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
# Default image references can be overridden via flags during installation.
BACKEND_IMAGE="ghcr.io/nyxandro/remote-vibe-station-backend:latest"
MINIAPP_IMAGE="ghcr.io/nyxandro/remote-vibe-station-miniapp:latest"
BOT_IMAGE="ghcr.io/nyxandro/remote-vibe-station-bot:latest"
OPENCODE_IMAGE="ghcr.io/nyxandro/remote-vibe-station-opencode:latest"
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
# Generate secrets once for generated runtime stack.
BOT_BACKEND_AUTH_TOKEN="rvs-bot-$(random_alnum 56)"
OPENCODE_SERVER_PASSWORD="$(random_alnum 48)"
CLIPROXY_MANAGEMENT_PASSWORD="$(random_alnum 48)"
CLIPROXY_API_KEY="sk-cliproxy-$(random_alnum 56)"
generate_runtime_files
if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run complete. Files generated in: $INSTALL_DIR"
  exit 0
fi
install_system_dependencies
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
