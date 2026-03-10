#!/bin/sh

# Proxy GitHub CLI through the backend-managed PAT when explicit GH_TOKEN is absent.

set -eu

if [ -n "${GH_TOKEN:-}" ]; then
  exec /usr/bin/gh "$@"
fi

if [ -z "${BACKEND_URL:-}" ] || [ -z "${BOT_BACKEND_AUTH_TOKEN:-}" ]; then
  exec /usr/bin/gh "$@"
fi

TOKEN="$({
  curl -fsS -X POST "${BACKEND_URL}/api/internal/github/git-credential" \
    -H 'content-type: application/json' \
    -H "x-bot-backend-token: ${BOT_BACKEND_AUTH_TOKEN}" \
    -d '{"protocol":"https","host":"github.com"}' || exit 0
} | node -e "let raw='';process.stdin.on('data',(chunk)=>raw+=chunk);process.stdin.on('end',()=>{if(!raw.trim()){return;} const parsed=JSON.parse(raw); process.stdout.write(String(parsed.password||''));});")"

if [ -z "${TOKEN}" ]; then
  exec /usr/bin/gh "$@"
fi

GH_TOKEN="${TOKEN}" exec /usr/bin/gh "$@"
