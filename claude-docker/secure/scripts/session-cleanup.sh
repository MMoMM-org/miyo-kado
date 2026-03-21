#!/bin/bash
# ============================================================
# session-cleanup.sh — 3x daily via cron
# - Kill zombie processes (>2h, 0% CPU)
# - Delete shell snapshots older than 7 days
# - Scrub credentials from transcripts
# - Output session statistics
# ============================================================

set -euo pipefail

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
CLAUDE_DIR="/home/coder/.claude"
LOG="$CLAUDE_DIR/cleanup.log"
TRANSCRIPT_DIR="$CLAUDE_DIR/projects"
mkdir -p "$CLAUDE_DIR"

echo "" >> "$LOG"
echo "[$TIMESTAMP] ── Session cleanup started ──" >> "$LOG"

# ── 1. Zombie processes (>2h runtime, <0.5% CPU) ─────────────
KILLED=0
while IFS= read -r LINE; do
    PID=$(echo "$LINE" | awk '{print $1}')
    ELAPSED=$(echo "$LINE" | awk '{print $2}')
    CPU=$(echo "$LINE" | awk '{print $3}' | tr -d ' ')
    [[ -z "$PID" || "$PID" == "PID" ]] && continue
    if (( ELAPSED > 7200 )) && (( $(echo "$CPU < 0.5" | bc -l 2>/dev/null || echo 0) )); then
        kill "$PID" 2>/dev/null && KILLED=$((KILLED+1)) || true
    fi
done < <(ps -eo pid,etimes,%cpu --no-headers 2>/dev/null || true)
echo "[$TIMESTAMP] Zombie processes killed: $KILLED" >> "$LOG"

# ── 2. Shell snapshots older than 7 days ─────────────────────
SNAPSHOTS_DELETED=0
if [[ -d "$CLAUDE_DIR/shell-snapshots" ]]; then
    while IFS= read -r F; do
        rm -f "$F" && SNAPSHOTS_DELETED=$((SNAPSHOTS_DELETED+1))
    done < <(find "$CLAUDE_DIR/shell-snapshots" -type f -mtime +7 2>/dev/null || true)
fi
echo "[$TIMESTAMP] Shell snapshots deleted: $SNAPSHOTS_DELETED" >> "$LOG"

# ── 3. Credential scrubbing from transcripts ─────────────────
CRED_PATTERN='(sk-ant-[a-zA-Z0-9_-]{10,}|sk-[a-zA-Z0-9_-]{20,}|Bearer [a-zA-Z0-9._-]{10,}|ANTHROPIC_API_KEY\s*=\s*\S+|password\s*[:=]\s*\S+|token\s*[:=]\s*\S+)'
SCRUBBED=0
if [[ -d "$TRANSCRIPT_DIR" ]]; then
    while IFS= read -r FILE; do
        if grep -qiE "$CRED_PATTERN" "$FILE" 2>/dev/null; then
            sed -i -E "s|$CRED_PATTERN|[SCRUBBED]|gi" "$FILE" 2>/dev/null || true
            SCRUBBED=$((SCRUBBED+1))
        fi
    done < <(find "$TRANSCRIPT_DIR" -type f \( -name "*.json" -o -name "*.md" -o -name "*.txt" \) 2>/dev/null || true)
fi
echo "[$TIMESTAMP] Transcript files scrubbed: $SCRUBBED" >> "$LOG"

# ── 4. Statistics ─────────────────────────────────────────────
SESSION_COUNT=$(find "$TRANSCRIPT_DIR" -type f 2>/dev/null | wc -l | tr -d ' ' || echo 0)
STORAGE=$(du -sh "$CLAUDE_DIR" 2>/dev/null | cut -f1 || echo "?")
echo "[$TIMESTAMP] Sessions: $SESSION_COUNT | Storage .claude: $STORAGE" >> "$LOG"
echo "[$TIMESTAMP] ── Cleanup complete ──" >> "$LOG"
