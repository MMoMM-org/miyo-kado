#!/bin/bash
# ============================================================
# security-scan.sh — PostToolUse Hook
# ClamAV scan after download/install commands.
# Input: JSON via stdin
# ============================================================

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool // ""')
COMMAND=$(echo "$INPUT" | jq -r '.input.command // ""')

# Only active for download-like Bash commands
[[ "$TOOL" != "Bash" ]] && exit 0
echo "$COMMAND" | grep -qE '(curl|wget|pip install|npm install|bun install|apt install)' || exit 0

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
LOGFILE="/home/coder/.claude/security-scan.log"
mkdir -p "$(dirname "$LOGFILE")"

echo "[$TIMESTAMP] PostToolUse scan triggered by: $(echo "$COMMAND" | head -c 80)" >> "$LOGFILE"

# Scan recently modified files in /repo
RECENT_FILES=$(find /repo -type f -newer /proc/1 2>/dev/null | head -50 || true)

if [[ -n "$RECENT_FILES" ]]; then
    CLAM_OUT=$(echo "$RECENT_FILES" | xargs clamscan --no-summary 2>/dev/null || true)
    if echo "$CLAM_OUT" | grep -q "FOUND"; then
        INFECTED=$(echo "$CLAM_OUT" | grep "FOUND")
        echo "[$TIMESTAMP] ⚠ MALWARE FOUND: $INFECTED" >> "$LOGFILE"
        echo "⚠ ClamAV: Malware detected! $INFECTED" >&2
    else
        echo "[$TIMESTAMP] ✓ Scan clean ($(echo "$RECENT_FILES" | wc -l) files)" >> "$LOGFILE"
    fi
else
    echo "[$TIMESTAMP] ✓ No new files found" >> "$LOGFILE"
fi

exit 0
