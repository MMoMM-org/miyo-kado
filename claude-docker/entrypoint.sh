#!/bin/bash
# entrypoint.sh — Container startup sequence
#
# Environment variables (passed via docker run -e):
#   REPO_NAME         — short name of the repo (for tab title, PS1)
#   REPO_MOUNT_PATH   — absolute path of the repo in container
#   CONFIG_VARIANT    — "general" | "secure" (used by init-home.sh templates)
#   GIT_USER_NAME     — git user.name (optional)
#   GIT_USER_EMAIL    — git user.email (optional)
#   CLAUDE_MODE       — "claude" (default) | "bash" (start shell instead)
#   YOLO              — "true" to pass --dangerously-skip-permissions to claude

set -e

# ── Home template rendering (first run) ─────────────────────
if [ -f "${HOME}/init-home.sh" ]; then
  # shellcheck source=/dev/null
  source "${HOME}/init-home.sh"
fi

# ── Firewall setup ──────────────────────────────────────────
# Firewall runs via DOCKER_ENTRYPOINT_PREFIX (as root, before this script).
# no-new-privileges blocks sudo, so it cannot run here.

# ── Terminal capabilities ────────────────────────────────────
# Docker passes TERM=xterm by default — too basic for Claude Code's TUI
# (shift-enter, text selection, true color). Force xterm-256color always.
export TERM="xterm-256color"
export COLORTERM="truecolor"

# ── Git user config ──────────────────────────────────────────
if [[ -n "${GIT_USER_NAME:-}" ]]; then
  git config --global user.name "$GIT_USER_NAME"
fi
if [[ -n "${GIT_USER_EMAIL:-}" ]]; then
  git config --global user.email "$GIT_USER_EMAIL"
fi

# ── Git housekeeping ────────────────────────────────────────
git config --global gc.auto 256

# ── Git hooks (idempotent — handles fresh clones) ────────────
if [ -d "${REPO_MOUNT_PATH}/.githooks" ]; then
  git -C "$REPO_MOUNT_PATH" config core.hooksPath .githooks
fi

# ── Git delta (if available) ─────────────────────────────────
if command -v delta &>/dev/null; then
  git config --global core.pager delta
  git config --global delta.navigate true
  git config --global delta.dark true
  git config --global interactive.diffFilter "delta --color-only"
fi

# ── Launch mode ─────────────────────────────────────────────
MODE="${CLAUDE_MODE:-claude}"

if [[ "$MODE" == "bash" ]]; then
  exec /bin/bash
fi

CLAUDE_ARGS=()
if [[ "${YOLO:-}" == "true" ]]; then
  CLAUDE_ARGS+=("--dangerously-skip-permissions")
fi

exec claude "${CLAUDE_ARGS[@]}"
