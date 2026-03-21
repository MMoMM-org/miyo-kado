#!/usr/bin/env bash
#
# The Custom Startup — Enhanced Statusline
#
# Two-line statusline with git info, context bar, token budget bar (via ccusage),
# OSC 8 hyperlinks, and session cost/duration.
#
# Configuration: ~/.config/the-agentic-startup/statusline.toml
#                or <repo>/.claude/statusline.toml  (per-repo override)
#
# Dependencies: jq, ccusage (bun x ccusage), git
# Input:        JSON from Claude Code via stdin
# Output:       Two formatted statusline lines with ANSI colors

# ==============================================================================
# Shared library
# ==============================================================================

source "$(dirname "${BASH_SOURCE[0]}")/the-custom-startup-statusline-lib.sh"

# ==============================================================================
# Input parsing
# ==============================================================================

read_input() {
  IFS= read -r -d '' JSON_INPUT || true

  MODEL=$(echo "$JSON_INPUT"        | jq -r '.model.display_name // "?"')
  CURRENT_DIR=$(echo "$JSON_INPUT"  | jq -r '.workspace.current_dir // .cwd // ""')
  CTX_PCT=$(echo "$JSON_INPUT"      | jq -r '.context_window.used_percentage // 0' \
    | cut -d. -f1)
  DURATION_MS=$(echo "$JSON_INPUT"  | jq -r '.cost.total_duration_ms // 0')
  SESSION_COST=$(echo "$JSON_INPUT" | jq -r '.cost.total_cost_usd // 0')
}

# ==============================================================================
# Formatters
# ==============================================================================

format_dirty() {
  local out=""
  [[ "${TCS_GIT_STAGED:-0}"   -gt 0 ]] && out+="${GREEN}+${TCS_GIT_STAGED}${RESET}"
  [[ "${TCS_GIT_MODIFIED:-0}" -gt 0 ]] && out+="${YELLOW}~${TCS_GIT_MODIFIED}${RESET}"
  [[ -n "$out" ]] && echo " $out"
}

# ==============================================================================
# Output
# ==============================================================================

render() {
  local line1="" line2=""

  # ── Line 1: identity ────────────────────────────────────────────────────────
  line1+="${CYAN}[${MODEL}]${RESET}"

  local dir_name="${CURRENT_DIR##*/}"
  [[ -n "$dir_name" ]] && line1+=" | 📁 ${dir_name}"

  if [[ "$tcs_cfg_show_git" == "true" && "$tcs_cfg_show_remote_url" == "true" \
      && -n "${TCS_GIT_REMOTEURL:-}" ]]; then
    line1+=" | ${YELLOW}🔗 ${TCS_GIT_REMOTEURL}${RESET}"
  fi

  if [[ "$tcs_cfg_show_git" == "true" && -n "${TCS_GIT_BRANCH:-}" ]]; then
    line1+=" | 🌿 ${TCS_GIT_BRANCH}$(format_dirty)"
  fi

  # ── Line 2: metrics ─────────────────────────────────────────────────────────

  # Context bar (block style, 10 chars)
  if [[ "$tcs_cfg_show_context_bar" == "true" ]]; then
    local ctx_bar
    ctx_bar=$(tcs_block_bar "$CTX_PCT" "$tcs_cfg_context_warn" "$tcs_cfg_context_danger")
    line2+="🧠 ${ctx_bar} ${CTX_PCT}%"
  fi

  # Duration
  if [[ "$tcs_cfg_show_duration" == "true" ]]; then
    local dur
    dur=$(tcs_format_duration "$DURATION_MS")
    [[ -n "$dur" ]] && line2+=" | ⏱ ${dur}"
  fi

  # Budget bar: token mode (default) or cost mode
  local budget_mode="${tcs_cfg_budget_mode:-token}"

  if [[ "$tcs_cfg_show_budget_bar" == "true" ]]; then
    if [[ "$budget_mode" == "token" && "${TCS_BLOCK_TOKENS:-0}" -gt 0 ]]; then
      # Token bar: inputTokens + outputTokens vs plan limit
      local tok_bar
      tok_bar=$(tcs_block_bar \
        "$TCS_BLOCK_TOKEN_PCT" "$tcs_cfg_budget_warn" "$tcs_cfg_budget_danger")
      local cost_fmt
      cost_fmt=$(printf '$%.2f' "${TCS_BLOCK_COST:-0}" 2>/dev/null || echo '$0.00')
      line2+=" | 💰 ${tok_bar} ${TCS_BLOCK_TOKEN_PCT}% ${cost_fmt}"
      [[ -n "${TCS_BLOCK_TIME_LEFT:-}" ]] && line2+=" | ⏳ ${TCS_BLOCK_TIME_LEFT}"

    elif [[ "$budget_mode" == "cost" ]]; then
      # Cost bar: session cost vs plan danger threshold
      local cost_pct=0
      if [[ -n "$SESSION_COST" && -n "$tcs_cfg_cost_danger" ]]; then
        cost_pct=$(awk -v c="$SESSION_COST" -v d="$tcs_cfg_cost_danger" \
          'BEGIN { pct = int(c / d * 100); print (pct > 100 ? 100 : pct) }')
      fi
      local cost_bar
      cost_bar=$(tcs_block_bar "$cost_pct" "$tcs_cfg_budget_warn" "$tcs_cfg_budget_danger")
      local cost_fmt
      cost_fmt=$(printf '$%.2f' "${SESSION_COST:-0}" 2>/dev/null || echo '$0.00')
      line2+=" | 💰 ${cost_bar} ${cost_pct}% ${cost_fmt}"
    fi
  fi

  # Set iTerm2 tab title on every statusline render — must write directly to the
  # PTY since stdout goes to Claude Code's renderer, not the terminal.
  local tab_name="${REPO_NAME:-${CURRENT_DIR##*/}}"
  if [[ -n "$tab_name" ]]; then
    local tty_dev
    tty_dev=$(ls /dev/pts/ 2>/dev/null | grep -E '^[0-9]+$' | sort -n | head -1)
    [[ -n "$tty_dev" ]] && printf '\033]1;%s\007' "$tab_name" > "/dev/pts/$tty_dev" 2>/dev/null || true
  fi

  echo -e "$line1"
  [[ -n "$line2" ]] && echo -e "$line2"
}

# ==============================================================================
# Help
# ==============================================================================

show_help() {
  cat << EOF
The Custom Startup — Enhanced Statusline

Usage: the-custom-startup-statusline-enhanced.sh [--help]

Config: ~/.config/the-agentic-startup/statusline.toml
        <repo>/.claude/statusline.toml  (per-repo override)

Key options:
  plan         = pro | max5x | max20x | api | auto
  budget_mode  = token | cost
  token_limit  = <number>  (manual override)
  show_budget_bar   = true | false
  show_context_bar  = true | false
  show_duration     = true | false
  show_git          = true | false
  show_remote_url   = true | false

  [thresholds.context]  warn / danger
  [thresholds.budget]   warn / danger

Token limits per 5h window (inputTokens + outputTokens):
  pro:    ~28,450   max5x: ~57,000   max20x: ~142,500
EOF
  exit 0
}

# ==============================================================================
# Main
# ==============================================================================

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && show_help

tcs_load_config
read_input
tcs_load_git_info "$CURRENT_DIR"
tcs_load_ccusage  "$CURRENT_DIR"
render
