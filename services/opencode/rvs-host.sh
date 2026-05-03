#!/usr/bin/env bash

set -euo pipefail

# Execute commands in the host namespaces from the trusted OpenCode runtime.
# The runtime mounts the host root at /hostfs and runs with host pid namespace.

if [[ $# -eq 0 ]]; then
  echo "Usage: rvs-host <command> [args...]" >&2
  exit 2
fi

if [[ ! -d /hostfs ]]; then
  echo "APP_HOST_ROOT_MISSING: Host root mount /hostfs is not available. Restart the runtime with /:/hostfs mounted." >&2
  exit 1
fi

if [[ ! -x /usr/bin/nsenter ]]; then
  echo "APP_NSENTER_MISSING: nsenter is not installed in the OpenCode runtime image. Rebuild the opencode image." >&2
  exit 1
fi

exec /usr/bin/nsenter --target 1 --mount --uts --ipc --net --pid --wd=/ "$@"
