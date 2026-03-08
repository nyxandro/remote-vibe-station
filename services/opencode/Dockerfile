FROM node:22-bookworm-slim

# Install operator tooling directly in the OpenCode container.
# This dev-oriented runtime is intentionally trusted with host access so the
# agent can execute git/docker/ssh workflows without routing through backend.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    docker-compose \
    docker.io \
    gh \
    git \
    jq \
    openssh-client \
    procps \
  && mkdir -p /usr/local/lib/docker/cli-plugins /usr/lib/docker/cli-plugins /usr/libexec/docker/cli-plugins \
  && ln -sf /usr/bin/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose \
  && ln -sf /usr/bin/docker-compose /usr/lib/docker/cli-plugins/docker-compose \
  && ln -sf /usr/bin/docker-compose /usr/libexec/docker/cli-plugins/docker-compose \
  && rm -rf /var/lib/apt/lists/*

# OpenCode CLI is published as the `opencode-ai` package on npm and exposes
# the `opencode` binary.
#
# Important: OpenCode bundles a native linux-x64 binary that targets glibc.
# Alpine uses musl, so we use a Debian-based image here.
RUN npm install -g opencode-ai

# Default to mounted project roots because most agent work starts there.
WORKDIR /srv/projects

COPY --chmod=755 entrypoint.sh /usr/local/bin/opencode-entrypoint.sh
COPY cliproxy-provider-config.js /usr/local/bin/cliproxy-provider-config.js
COPY --chmod=755 docker-wrapper.sh /usr/local/bin/docker

ENTRYPOINT ["/usr/local/bin/opencode-entrypoint.sh"]
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
