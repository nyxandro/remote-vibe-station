#!/usr/bin/env bash

# Shared host-management helpers for the image-only runtime installer.
# Keep heavy system functions here so install-runtime.sh remains a readable entrypoint.

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
    iproute2 \
    jq \
    openssl \
    ufw \
    fail2ban
}

install_github_cli_if_possible() {
  # GitHub CLI is useful for operators but must not block a clean runtime install.
  if command -v gh >/dev/null 2>&1; then
    return
  fi

  if apt-get install -y --no-install-recommends gh; then
    return
  fi

  echo "WARNING: GitHub CLI is unavailable; continuing without host-level gh auth" >&2
}

authenticate_github_cli() {
  # Configure gh non-interactively when token is provided by operator.
  if [[ -z "$GITHUB_TOKEN" ]]; then
    return
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "WARNING: GitHub CLI is unavailable; skipping host gh auth" >&2
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
    if ! command -v jq >/dev/null 2>&1; then
      echo "WARNING: jq is required to merge $daemon_path safely; keeping existing Docker daemon config unchanged" >&2
      return
    fi

    cp "$daemon_path" "${daemon_path}.bak"

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
