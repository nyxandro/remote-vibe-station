FROM node:22-bookworm-slim

# Install operator tooling directly in the OpenCode container.
# This dev-oriented runtime is intentionally trusted with host access so the
# agent can execute git/docker/ssh workflows without routing through backend.
ENV TOOLBOX_ROOT=/toolbox \
  XDG_CACHE_HOME=/toolbox/cache \
  NPM_CONFIG_PREFIX=/toolbox/npm-global \
  NPM_CONFIG_CACHE=/toolbox/cache/npm \
  PNPM_HOME=/toolbox/pnpm \
  PNPM_STORE_DIR=/toolbox/pnpm/store \
  PIPX_HOME=/toolbox/pipx \
  PIPX_BIN_DIR=/toolbox/bin \
  PIP_CACHE_DIR=/toolbox/cache/pip \
  PYTHONUSERBASE=/toolbox/python-user \
  PLAYWRIGHT_BROWSERS_PATH=/toolbox/playwright \
  UV_TOOL_BIN_DIR=/toolbox/bin \
  UV_TOOL_DIR=/toolbox/uv/tools \
  UV_CACHE_DIR=/toolbox/cache/uv \
  NODE_PATH=/toolbox/npm-global/lib/node_modules \
  PATH=/toolbox/bin:/toolbox/npm-global/bin:/toolbox/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    chromium \
    curl \
    docker-compose \
    docker.io \
    fd-find \
    ffmpeg \
    file \
    fonts-liberation \
    gh \
    git \
    jq \
    less \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libu2f-udev \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    openssh-client \
    pipx \
    pkg-config \
    procps \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    rsync \
    unzip \
    util-linux \
    wget \
    xz-utils \
    zip \
  && mkdir -p /usr/local/lib/docker/cli-plugins /usr/lib/docker/cli-plugins /usr/libexec/docker/cli-plugins \
  && mkdir -p \
    /toolbox/bin \
    /toolbox/cache/npm \
    /toolbox/cache/pip \
    /toolbox/cache/uv \
    /toolbox/npm-global \
    /toolbox/pipx \
    /toolbox/playwright \
    /toolbox/pnpm/store \
    /toolbox/python-user \
    /toolbox/uv/tools \
  && ln -sf /usr/bin/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose \
  && ln -sf /usr/bin/docker-compose /usr/lib/docker/cli-plugins/docker-compose \
  && ln -sf /usr/bin/docker-compose /usr/libexec/docker/cli-plugins/docker-compose \
  && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
  && ln -sf /usr/bin/chromium /usr/local/bin/google-chrome \
  && ln -sf /usr/bin/chromium /usr/local/bin/google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

# OpenCode CLI is published as the `opencode-ai` package on npm and exposes
# the `opencode` binary.
#
# Important: OpenCode bundles a native linux-x64 binary that targets glibc.
# Alpine uses musl, so we use a Debian-based image here.
RUN corepack enable \
  && npm install -g opencode-ai playwright tsx typescript \
  && pipx install uv

# Default to mounted project roots because most agent work starts there.
WORKDIR /srv/projects

COPY --chmod=755 entrypoint.sh /usr/local/bin/opencode-entrypoint.sh
COPY cliproxy-provider-config.js /usr/local/bin/cliproxy-provider-config.js
COPY --chmod=755 github-git-credential.js /usr/local/bin/github-git-credential.js
COPY --chmod=755 github-gh-auth-wrapper.sh /usr/local/bin/gh
COPY kanban-plugin-sync.js /usr/local/bin/kanban-plugin-sync.js
COPY telegram-media-plugin-sync.js /usr/local/bin/telegram-media-plugin-sync.js
COPY opencode-auto-update.js /usr/local/bin/opencode-auto-update.js
COPY skills-bundle-sync.js /usr/local/bin/skills-bundle-sync.js
COPY kanban-tools-plugin.ts /usr/local/share/opencode/kanban-tools-plugin.ts
COPY telegram-media-tools-plugin.ts /usr/local/share/opencode/telegram-media-tools-plugin.ts
COPY skills /usr/local/share/opencode/skills
COPY --chmod=755 docker-wrapper.sh /usr/local/bin/docker
COPY --chmod=755 rvs-host.sh /usr/local/bin/rvs-host
COPY toolbox-profile.sh /etc/profile.d/toolbox.sh

ENTRYPOINT ["/usr/local/bin/opencode-entrypoint.sh"]
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
