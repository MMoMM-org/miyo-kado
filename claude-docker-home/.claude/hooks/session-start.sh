#!/bin/bash
# session-start.sh — Claude Code SessionStart hook
#
# Validates plugin installation state against the deployment registry.
# Becomes a no-op once all plugins are confirmed installed.
#
# Plugin installation is handled by Claude Code via enabledPlugins in settings.json.
# This hook checks state and reports missing plugins — it does not install.
#
# Registry paths come from begin-code.sh via env vars:
#   CLAUDE_REGISTRY_DEFAULT — path to default-registry.json (all containers)
#   CLAUDE_REGISTRY_REPO    — path to <repo>-registry.json (optional overrides)

set -euo pipefail

MARKER="${HOME}/.claude/.plugins-initialized"
INSTALLED="${HOME}/.claude/plugins/installed_plugins.json"

DEFAULT_REGISTRY="${CLAUDE_REGISTRY_DEFAULT:-/home/coder/Kouzou/registries/default-registry.json}"
REPO_REGISTRY="${CLAUDE_REGISTRY_REPO:-}"

# Already validated — skip
if [ -f "$MARKER" ]; then
  exit 0
fi

# Registry not accessible — skip silently
if [ ! -f "$DEFAULT_REGISTRY" ]; then
  exit 0
fi

# Build merged plugin list: default + repo-specific (if exists)
if [ -n "$REPO_REGISTRY" ] && [ -f "$REPO_REGISTRY" ]; then
  PLUGIN_LIST=$(jq -rs '
    (.[0].plugins // []) + (.[1].plugins // []) | unique
  ' "$DEFAULT_REGISTRY" "$REPO_REGISTRY")
else
  PLUGIN_LIST=$(jq -r '.plugins // []' "$DEFAULT_REGISTRY")
fi

# Installed plugins file not present yet — first run, plugins pending
if [ ! -f "$INSTALLED" ]; then
  echo "[session-start] Plugins not yet installed. Claude Code will install them automatically."
  echo "[session-start] If plugins don't appear, run /setup-docker-home"
  exit 0
fi

# Check each required plugin
MISSING=()
while IFS= read -r plugin; do
  if ! jq -e --arg p "$plugin" '.plugins[$p] | length > 0' "$INSTALLED" > /dev/null 2>&1; then
    MISSING+=("$plugin")
  fi
done < <(echo "$PLUGIN_LIST" | jq -r '.[]')

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "[session-start] Missing plugins: ${MISSING[*]}"
  echo "[session-start] Run /setup-docker-home to install them."
  exit 0
fi

# All plugins present — write marker
touch "$MARKER"
exit 0
