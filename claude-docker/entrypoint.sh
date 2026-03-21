#!/bin/bash
# entrypoint.sh — Container startup sequence
#
# Environment variables (passed via docker run -e):
#   REPO_NAME       — short name of the repo (for tab title, PS1)
#   GIT_USER_NAME   — git user.name (optional)
#   GIT_USER_EMAIL  — git user.email (optional)
#   CLAUDE_MODE     — "claude" (default) | "bash" (start shell instead)
#   YOLO            — "true" to pass --dangerously-skip-permissions to claude

set -e

# ── Git user config ──────────────────────────────────────────
if [[ -n "${GIT_USER_NAME:-}" ]]; then
  git config --global user.name "$GIT_USER_NAME"
fi
if [[ -n "${GIT_USER_EMAIL:-}" ]]; then
  git config --global user.email "$GIT_USER_EMAIL"
fi

# ── Git housekeeping ────────────────────────────────────────
git config --global gc.auto 256

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
