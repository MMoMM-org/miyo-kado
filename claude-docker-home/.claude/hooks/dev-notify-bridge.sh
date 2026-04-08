#!/bin/bash
# Notification hook — forwards Claude Code events to dev-notify-bridge on host
# dev-notify-bridge must be running on host (managed by begin-code.sh)
# See: https://github.com/Uwancha/dev-notify-bridge

INPUT=$(cat)
BASE_TITLE=$(echo "$INPUT" | jq -r '.title // "Claude Code"')
MESSAGE=$(echo "$INPUT" | jq -r '.message // ""')

# Prefix with repo name so notifications identify which container they came from
TITLE="${REPO_NAME:+[$REPO_NAME] }${BASE_TITLE}"

# dev-notify-bridge listens on host port (default 9999, configurable via env)
PORT="${DEV_NOTIFY_PORT:-9999}"

curl -s -X POST "http://host.docker.internal:${PORT}/notify" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"${TITLE}\", \"message\": \"${MESSAGE}\"}" \
  2>/dev/null || true

exit 0
