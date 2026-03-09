#!/usr/bin/env sh

# Re-apply toolbox paths for login shells because /etc/profile resets PATH.
export TOOLBOX_ROOT="${TOOLBOX_ROOT:-/toolbox}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-${TOOLBOX_ROOT}/cache}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-${TOOLBOX_ROOT}/npm-global}"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-${TOOLBOX_ROOT}/cache/npm}"
export PNPM_HOME="${PNPM_HOME:-${TOOLBOX_ROOT}/pnpm}"
export PNPM_STORE_DIR="${PNPM_STORE_DIR:-${TOOLBOX_ROOT}/pnpm/store}"
export PIPX_HOME="${PIPX_HOME:-${TOOLBOX_ROOT}/pipx}"
export PIPX_BIN_DIR="${PIPX_BIN_DIR:-${TOOLBOX_ROOT}/bin}"
export PIP_CACHE_DIR="${PIP_CACHE_DIR:-${TOOLBOX_ROOT}/cache/pip}"
export PYTHONUSERBASE="${PYTHONUSERBASE:-${TOOLBOX_ROOT}/python-user}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${TOOLBOX_ROOT}/playwright}"
export UV_TOOL_BIN_DIR="${UV_TOOL_BIN_DIR:-${TOOLBOX_ROOT}/bin}"
export UV_TOOL_DIR="${UV_TOOL_DIR:-${TOOLBOX_ROOT}/uv/tools}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-${TOOLBOX_ROOT}/cache/uv}"
export NODE_PATH="${NODE_PATH:-${TOOLBOX_ROOT}/npm-global/lib/node_modules}"
export PATH="${TOOLBOX_ROOT}/bin:${TOOLBOX_ROOT}/npm-global/bin:${TOOLBOX_ROOT}/pnpm:${PATH}"
