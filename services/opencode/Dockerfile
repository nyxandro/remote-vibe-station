FROM node:22-bookworm-slim

# Used by docker healthcheck in compose.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# OpenCode CLI is published as the `opencode-ai` package on npm and exposes
# the `opencode` binary.
#
# Important: OpenCode bundles a native linux-x64 binary that targets glibc.
# Alpine uses musl, so we use a Debian-based image here.
RUN npm install -g opencode-ai

WORKDIR /workspace

CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
