#!/bin/bash
#
# The Custom Startup — Statusline Shared Library
#
# Sourced by all statusline scripts. Provides:
#   - Color constants
#   - TOML parser
#   - Unified config loading (global + per-repo)
#   - Cache helpers
#   - Plan data (token limits + cost thresholds)
#
# Usage: source "$(dirname "${BASH_SOURCE[0]}")/statusline-lib.sh"

# Guard against double-sourcing
[[ "${_TCS_STATUSLINE_LIB_LOADED:-}" == "1" ]] && return 0
readonly _TCS_STATUSLINE_LIB_LOADED=1

# ==============================================================================
# Colors
# ==============================================================================

readonly TCS_COLOR_DEFAULT="\033[38;2;250;250;250m"
readonly TCS_COLOR_MUTED="\033[38;2;96;96;96m"
readonly TCS_COLOR_SUCCESS="\033[0;32m"
readonly TCS_COLOR_WARNING="\033[0;33m"
readonly TCS_COLOR_DANGER="\033[0;31m"
readonly TCS_COLOR_CYAN="\033[0;36m"
readonly TCS_COLOR_BRIGHT_GREEN="\033[1;32m"
readonly TCS_STYLE_DIM="\033[2m"
readonly TCS_STYLE_RESET="\033[0m"

# Shorter aliases for use in output formatters
GREEN="$TCS_COLOR_SUCCESS"
YELLOW="$TCS_COLOR_WARNING"
RED="$TCS_COLOR_DANGER"
CYAN="$TCS_COLOR_CYAN"
DIM="$TCS_STYLE_DIM"
RESET="$TCS_STYLE_RESET"

# ==============================================================================
# Logging (used by configurator and scripts alike)
# ==============================================================================

tcs_info()    { printf "${TCS_STYLE_DIM}→${TCS_STYLE_RESET} %s\n" "$*"; }
tcs_warn()    { printf "${TCS_COLOR_WARNING}!${TCS_STYLE_RESET} %s\n" "$*" >&2; }
tcs_error()   { printf "${TCS_COLOR_DANGER}✗${TCS_STYLE_RESET} %s\n" "$*" >&2; }
tcs_success() { printf "${TCS_COLOR_SUCCESS}✓${TCS_STYLE_RESET} %s\n" "$*"; }
tcs_header()  { printf "\n${TCS_COLOR_BRIGHT_GREEN}── %s${TCS_STYLE_RESET}\n" "$*"; }
tcs_ask()     { printf "${TCS_COLOR_CYAN}?${TCS_STYLE_RESET} %s " "$*"; }

# ==============================================================================
# Plan data
# ==============================================================================

# Token limits per 5h billing window (inputTokens + outputTokens, no cache reads)
# Pro limit calibrated from measurement: 9388 tokens = 33% → 28,450 limit.
# Max 5x / Max 20x extrapolated proportionally (unverified).
# Using case functions instead of declare -A for bash 3.2 compatibility.
_tcs_plan_token_limit() {
  case "${1:-pro}" in
    max20x) echo 142500 ;;
    max5x)  echo 57000  ;;
    api)    echo 28450  ;;
    *)      echo 28450  ;;  # pro + unknown → calibrated default
  esac
}

# Cost thresholds per session (warn / danger in USD)
_tcs_plan_cost_warn() {
  case "${1:-pro}" in
    max20x) echo 10.00 ;;
    max5x)  echo 5.00  ;;
    api)    echo 2.00  ;;
    *)      echo 1.50  ;;  # pro
  esac
}

_tcs_plan_cost_danger() {
  case "${1:-pro}" in
    max20x) echo 30.00 ;;
    max5x)  echo 15.00 ;;
    api)    echo 10.00 ;;
    *)      echo 5.00  ;;  # pro
  esac
}

# ==============================================================================
# TOML parser
# ==============================================================================

# tcs_toml_get <file> <key> [section]
# Returns the value of a key, optionally scoped to a section.
# Strips quotes and inline comments.
tcs_toml_get() {
  local file="$1" key="$2" section="${3:-}"
  [[ ! -f "$file" ]] && return 1

  local in_section=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip blank lines and comments
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

    # Section header
    if [[ "$line" =~ ^\[([a-zA-Z0-9_.]+)\] ]]; then
      in_section="${BASH_REMATCH[1]}"
      continue
    fi

    # Key = value
    if [[ "$line" =~ ^[[:space:]]*([a-zA-Z_][a-zA-Z0-9_]*)[[:space:]]*=[[:space:]]*(.+)$ ]]; then
      local k="${BASH_REMATCH[1]}" v="${BASH_REMATCH[2]}"

      local scope_match=0
      [[ -z "$section" && -z "$in_section" ]] && scope_match=1
      [[ -n "$section" && "$in_section" == "$section" ]] && scope_match=1

      if [[ "$scope_match" == "1" && "$k" == "$key" ]]; then
        v="${v%%#*}"                       # strip inline comment
        v="${v%"${v##*[![:space:]]}"}"     # rtrim
        v="${v#\"}" v="${v%\"}"            # strip quotes
        echo "$v"
        return 0
      fi
    fi
  done < "$file"
  return 1
}

# ==============================================================================
# Config paths
# ==============================================================================

readonly TCS_GLOBAL_CONFIG_DIR="$HOME/.config/the-custom-startup"
readonly TCS_GLOBAL_CONFIG_FILE="$TCS_GLOBAL_CONFIG_DIR/statusline.toml"
readonly TCS_CLAUDE_SETTINGS="$HOME/.claude/settings.json"

# Find per-repo config by walking up from current dir
tcs_find_repo_config() {
  local dir
  dir=$(pwd)
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/.claude/statusline.toml" ]]; then
      echo "$dir/.claude/statusline.toml"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# ==============================================================================
# Config defaults
# ==============================================================================

tcs_cfg_plan="pro"
tcs_cfg_fallback_plan="pro"
tcs_cfg_budget_mode="cost"          # "cost" | "token" — which bar to show
tcs_cfg_token_limit=""              # resolved after load
tcs_cfg_token_limit_manual=""       # explicit TOML override
tcs_cfg_cost_warn=""                # resolved after load
tcs_cfg_cost_danger=""              # resolved after load

tcs_cfg_context_warn=70
tcs_cfg_context_danger=90
tcs_cfg_budget_warn=70
tcs_cfg_budget_danger=90

tcs_cfg_ccusage_cache_ttl=60
tcs_cfg_git_cache_ttl=15

tcs_cfg_show_budget_bar=true
tcs_cfg_show_context_bar=true
tcs_cfg_show_duration=true
tcs_cfg_show_git=true
tcs_cfg_show_remote_url=true

# Standard statusline format (placeholder-based)
tcs_cfg_format="<path> <branch>  <model>  <context>  <session>  <help>"

# ==============================================================================
# Config loading
# ==============================================================================

# Load a single config file into tcs_cfg_* variables
_tcs_load_config_file() {
  local file="$1"
  [[ ! -f "$file" ]] && return

  local v
  v=$(tcs_toml_get "$file" "plan")               && tcs_cfg_plan="$v"
  v=$(tcs_toml_get "$file" "fallback_plan")      && tcs_cfg_fallback_plan="$v"
  v=$(tcs_toml_get "$file" "budget_mode")        && tcs_cfg_budget_mode="$v"
  v=$(tcs_toml_get "$file" "token_limit")        && tcs_cfg_token_limit_manual="$v"
  v=$(tcs_toml_get "$file" "ccusage_cache_ttl")  && tcs_cfg_ccusage_cache_ttl="$v"
  v=$(tcs_toml_get "$file" "git_cache_ttl")      && tcs_cfg_git_cache_ttl="$v"
  v=$(tcs_toml_get "$file" "show_budget_bar")    && tcs_cfg_show_budget_bar="$v"
  v=$(tcs_toml_get "$file" "show_context_bar")   && tcs_cfg_show_context_bar="$v"
  v=$(tcs_toml_get "$file" "show_duration")      && tcs_cfg_show_duration="$v"
  v=$(tcs_toml_get "$file" "show_git")           && tcs_cfg_show_git="$v"
  v=$(tcs_toml_get "$file" "show_remote_url")    && tcs_cfg_show_remote_url="$v"
  v=$(tcs_toml_get "$file" "format")             && tcs_cfg_format="$v"

  v=$(tcs_toml_get "$file" "warn"   "thresholds.context") && tcs_cfg_context_warn="$v"
  v=$(tcs_toml_get "$file" "danger" "thresholds.context") && tcs_cfg_context_danger="$v"
  v=$(tcs_toml_get "$file" "warn"   "thresholds.budget")  && tcs_cfg_budget_warn="$v"
  v=$(tcs_toml_get "$file" "danger" "thresholds.budget")  && tcs_cfg_budget_danger="$v"

  # Legacy compat: thresholds.cost and thresholds.token map to thresholds.budget
  v=$(tcs_toml_get "$file" "warn"   "thresholds.cost")    && tcs_cfg_budget_warn="$v"
  v=$(tcs_toml_get "$file" "danger" "thresholds.cost")    && tcs_cfg_budget_danger="$v"
  v=$(tcs_toml_get "$file" "warn"   "thresholds.token")   && tcs_cfg_budget_warn="$v"
  v=$(tcs_toml_get "$file" "danger" "thresholds.token")   && tcs_cfg_budget_danger="$v"

  # Explicit cost threshold overrides
  v=$(tcs_toml_get "$file" "warn"   "thresholds.cost") && tcs_cfg_cost_warn="$v"
  v=$(tcs_toml_get "$file" "danger" "thresholds.cost") && tcs_cfg_cost_danger="$v"
}

# Load global config, then per-repo overlay
tcs_load_config() {
  _tcs_load_config_file "$TCS_GLOBAL_CONFIG_FILE"

  local repo_config
  repo_config=$(tcs_find_repo_config 2>/dev/null) && \
    _tcs_load_config_file "$repo_config"

  # Resolve effective plan (auto-detect falls back to fallback_plan)
  local effective_plan="$tcs_cfg_plan"
  if [[ "$effective_plan" == "auto" ]]; then
    effective_plan=$(_tcs_detect_plan)
  fi

  # Resolve token limit: manual override → plan default
  if [[ -n "$tcs_cfg_token_limit_manual" ]]; then
    tcs_cfg_token_limit="$tcs_cfg_token_limit_manual"
  else
    tcs_cfg_token_limit="$(_tcs_plan_token_limit "$effective_plan")"
  fi

  # Resolve cost thresholds: explicit → plan default
  [[ -z "$tcs_cfg_cost_warn" ]]   && tcs_cfg_cost_warn="$(_tcs_plan_cost_warn "$effective_plan")"
  [[ -z "$tcs_cfg_cost_danger" ]] && tcs_cfg_cost_danger="$(_tcs_plan_cost_danger "$effective_plan")"

  # Housekeeping: remove stale /tmp cache files (throttled to once per day)
  tcs_cleanup_tmp_cache
}

_tcs_detect_plan() {
  if [[ -f "$TCS_CLAUDE_SETTINGS" ]] && command -v jq &>/dev/null; then
    local plan_info
    plan_info=$(jq -r '.subscription.plan // .plan // empty' "$TCS_CLAUDE_SETTINGS" 2>/dev/null)
    case "$plan_info" in
      *max*20*|*20x*) echo "max20x"; return ;;
      *max*5*|*5x*)   echo "max5x";  return ;;
      *pro*)          echo "pro";    return ;;
      *api*)          echo "api";    return ;;
    esac
  fi
  echo "$tcs_cfg_fallback_plan"
}

# ==============================================================================
# Cache helpers
# ==============================================================================

tcs_cache_is_stale() {
  local file="$1" max_age="$2"
  [[ ! -f "$file" ]] && return 0
  local mtime
  mtime=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null || echo 0)
  [[ $(( $(date +%s) - mtime )) -gt "$max_age" ]]
}

tcs_cache_key() {
  echo "$1" | cksum | cut -d' ' -f1
}

# Remove /tmp cache files older than 14 days — throttled to once per day.
tcs_cleanup_tmp_cache() {
  local stamp="/tmp/tcs-statusline-cleanup-stamp"
  tcs_cache_is_stale "$stamp" 86400 || return 0
  find /tmp -maxdepth 1 -name "tcs-statusline-*" -mtime +14 -delete 2>/dev/null || true
  touch "$stamp"
}

# ==============================================================================
# Shared formatters
# ==============================================================================

# Block bar: 10 chars, █ filled / ░ empty, color-coded by percentage
# Usage: tcs_block_bar <pct> <warn_pct> <danger_pct>
tcs_block_bar() {
  local pct="$1" warn="$2" danger="$3"
  local color="$GREEN"
  [[ "$pct" -ge "$warn" ]]   && color="$YELLOW"
  [[ "$pct" -ge "$danger" ]] && color="$RED"

  local filled=$(( pct / 10 ))
  local empty=$(( 10 - filled ))
  local bar="" i
  for ((i=0; i<filled; i++)); do bar+='█'; done
  for ((i=0; i<empty; i++)); do bar+='░'; done
  printf '%b%s%b' "$color" "$bar" "$RESET"
}

# Duration: ms → human-readable
tcs_format_duration() {
  local ms="$1"
  [[ -z "$ms" || "$ms" == "null" || "$ms" -eq 0 ]] && return
  local total_s=$(( ms / 1000 ))
  local h=$(( total_s / 3600 ))
  local m=$(( (total_s % 3600) / 60 ))
  local s=$(( total_s % 60 ))
  if   [[ "$h" -gt 0 && "$m" -gt 0 ]]; then echo "${h}h ${m}m"
  elif [[ "$h" -gt 0 ]];               then echo "${h}h"
  elif [[ "$m" -gt 0 ]];               then echo "${m}m ${s}s"
  else                                       echo "${s}s"
  fi
}

# Decimal comparison: returns 0 if $1 >= $2
tcs_decimal_gte() {
  awk -v a="$1" -v b="$2" 'BEGIN { exit !(a >= b) }'
}

# ==============================================================================
# Shared data loaders
# ==============================================================================

# Load git info into TCS_GIT_* variables (cached)
# Sets: TCS_GIT_BRANCH, TCS_GIT_STAGED, TCS_GIT_MODIFIED, TCS_GIT_REMOTEURL
tcs_load_git_info() {
  TCS_GIT_BRANCH="" TCS_GIT_STAGED=0 TCS_GIT_MODIFIED=0 TCS_GIT_REMOTEURL=""

  [[ "$tcs_cfg_show_git" != "true" ]] && return

  local dir="${1:-$(pwd)}"
  local cache_file="/tmp/tcs-statusline-git-$(tcs_cache_key "$dir")"

  if tcs_cache_is_stale "$cache_file" "$tcs_cfg_git_cache_ttl"; then
    if git -C "$dir" rev-parse --git-dir > /dev/null 2>&1; then
      local branch staged modified remote repo_name osc_link=""

      branch=$(git -C "$dir" branch --show-current 2>/dev/null || echo "HEAD")
      staged=$(git -C "$dir" diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
      modified=$(git -C "$dir" diff --numstat 2>/dev/null | wc -l | tr -d ' ')

      remote=$(git -C "$dir" remote get-url origin 2>/dev/null \
        | sed 's/git@github.com:/https:\/\/github.com\//' \
        | sed 's/\.git$//' || echo "")
      repo_name=$(basename "$remote" 2>/dev/null || echo "")

      if [[ -n "$repo_name" && "$tcs_cfg_show_remote_url" == "true" ]]; then
        osc_link="$repo_name"
      fi

      printf '%s|%s|%s|%s\n' "$branch" "$staged" "$modified" "$osc_link" > "$cache_file"
    else
      printf '|||' > "$cache_file"
    fi
  fi

  IFS='|' read -r TCS_GIT_BRANCH TCS_GIT_STAGED TCS_GIT_MODIFIED TCS_GIT_REMOTEURL \
    < "$cache_file"
}

# Load ccusage block data into TCS_BLOCK_* variables (cached)
# Sets: TCS_BLOCK_INPUT_TOKENS, TCS_BLOCK_OUTPUT_TOKENS, TCS_BLOCK_TOKENS,
#       TCS_BLOCK_COST, TCS_BLOCK_TIME_LEFT, TCS_BLOCK_TOKEN_PCT
tcs_load_ccusage() {
  TCS_BLOCK_INPUT_TOKENS=0 TCS_BLOCK_OUTPUT_TOKENS=0 TCS_BLOCK_TOKENS=0
  TCS_BLOCK_COST="0" TCS_BLOCK_TIME_LEFT="" TCS_BLOCK_TOKEN_PCT=0

  local dir="${1:-$(pwd)}"
  local cache_file="/tmp/tcs-statusline-ccusage-$(tcs_cache_key "$dir")"

  if tcs_cache_is_stale "$cache_file" "$tcs_cfg_ccusage_cache_ttl"; then
    local timeout_cmd=""
    command -v gtimeout > /dev/null 2>&1 && timeout_cmd="gtimeout 5"
    command -v timeout  > /dev/null 2>&1 && timeout_cmd="timeout 5"

    local blocks_json
    blocks_json=$($timeout_cmd bun x ccusage blocks --json 2>/dev/null || echo "")

    if [[ -n "$blocks_json" ]]; then
      local active
      active=$(echo "$blocks_json" | jq -r \
        '[.blocks[] | select(.isActive == true and .isGap == false)] | .[0]' 2>/dev/null)

      if [[ -n "$active" && "$active" != "null" ]]; then
        local in_tok out_tok cost remaining_mins
        in_tok=$(echo "$active"  | jq -r '.tokenCounts.inputTokens  // 0')
        out_tok=$(echo "$active" | jq -r '.tokenCounts.outputTokens // 0')
        cost=$(echo "$active"    | jq -r '.costUSD // 0')
        remaining_mins=$(echo "$active" | jq -r '.projection.remainingMinutes // empty')

        local time_left=""
        if [[ -n "$remaining_mins" && "$remaining_mins" != "null" ]]; then
          local m
          m=$(printf '%.0f' "$remaining_mins" 2>/dev/null || echo 0)
          if [[ "$m" -ge 60 ]]; then
            time_left="$(( m / 60 ))h $(( m % 60 ))m left"
          else
            time_left="${m}m left"
          fi
        fi

        printf '%s|%s|%s|%s\n' \
          "$(( in_tok + out_tok ))" "$cost" "$time_left" "$in_tok" \
          > "$cache_file"
      fi
    fi

    # Write empty cache on failure to avoid hammering ccusage
    [[ ! -f "$cache_file" ]] && printf '0|0||0' > "$cache_file"
  fi

  local raw_in_tok
  IFS='|' read -r TCS_BLOCK_TOKENS TCS_BLOCK_COST TCS_BLOCK_TIME_LEFT raw_in_tok \
    < "$cache_file"

  # Token percentage vs plan limit
  TCS_BLOCK_TOKEN_PCT=0
  if [[ "${tcs_cfg_token_limit:-0}" -gt 0 && "${TCS_BLOCK_TOKENS:-0}" -gt 0 ]]; then
    TCS_BLOCK_TOKEN_PCT=$(( TCS_BLOCK_TOKENS * 100 / tcs_cfg_token_limit ))
    [[ "$TCS_BLOCK_TOKEN_PCT" -gt 100 ]] && TCS_BLOCK_TOKEN_PCT=100
  fi
}
