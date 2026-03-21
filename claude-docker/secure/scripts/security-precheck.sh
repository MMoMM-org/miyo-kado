#!/bin/bash
# ============================================================
# security-precheck.sh — PreToolUse Hook
# Blocks dangerous Bash commands before execution.
# Input:  JSON via stdin { "tool": "...", "input": { "command": "..." } }
# Output: { "decision": "block"|"allow", "reason": "..." }
# ============================================================

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool // ""')
COMMAND=$(echo "$INPUT" | jq -r '.input.command // ""')

block() {
    echo "{\"decision\":\"block\",\"reason\":\"$1\"}"
    exit 0
}

allow() {
    echo "{\"decision\":\"allow\"}"
    exit 0
}

# Only check Bash tool calls
[[ "$TOOL" != "Bash" ]] && allow

# ── 1. Dangerous flags ───────────────────────────────────────
if echo "$COMMAND" | grep -qE '(--dangerously-skip-permissions|--no-verify|--force\b)'; then
    block "Dangerous flag detected: --dangerously-skip-permissions / --no-verify / --force"
fi

# ── 2. Pipe-to-shell patterns ────────────────────────────────
if echo "$COMMAND" | grep -qE '(curl|wget)[^|]*\|[[:space:]]*(bash|sh|zsh|fish|dash)'; then
    block "Pipe-to-shell blocked: piping curl/wget directly into a shell is not allowed"
fi

# ── 3. Dangerous rm on critical directories ──────────────────
if echo "$COMMAND" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f|-[a-zA-Z]*f\s+-[a-zA-Z]*r)[a-zA-Z]*'; then
    if echo "$COMMAND" | grep -qE 'rm\s+-[rf]+\s+(/\s*$|/\s+|~\s*$|~\/|\$HOME|\.claude|\.ssh|\.gnupg)'; then
        block "rm -rf on critical directory blocked (/, ~, .claude, .ssh, .gnupg)"
    fi
fi

# ── 4. World-writable permissions ────────────────────────────
if echo "$COMMAND" | grep -qE 'chmod\s+(777|a\+rwx|o\+w)'; then
    block "chmod 777 / a+rwx / o+w blocked (world-writable permissions not allowed)"
fi

# ── 5. Credential exfiltration ───────────────────────────────
if echo "$COMMAND" | grep -qiE '(curl|wget|nc|ncat)\b.*\b(API_KEY|TOKEN|PASSWORD|SECRET|ANTHROPIC_KEY)\b'; then
    block "Possible credential exfiltration detected (network tool with sensitive variable names)"
fi

# ── 6. Supply chain: npm/bun install → Socket CLI check ──────
if echo "$COMMAND" | grep -qE '(npm|bun)\s+install\s+\S'; then
    PACKAGES=$(echo "$COMMAND" | sed 's/.*install//' | tr ' ' '\n' | grep -v '^-' | grep -v '^\s*$' | head -5 || true)
    if [[ -n "$PACKAGES" ]]; then
        SOCKET_RESULT=$(echo "$PACKAGES" | xargs socket npm report 2>&1 || true)
        if echo "$SOCKET_RESULT" | grep -qiE '(critical|malware|typosquat)'; then
            block "Socket CLI supply-chain warning for package(s): $(echo "$SOCKET_RESULT" | grep -iE 'critical|malware|typosquat' | head -2)"
        fi
    fi
fi

allow
