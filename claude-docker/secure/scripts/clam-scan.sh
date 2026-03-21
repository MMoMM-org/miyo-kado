#!/bin/bash
# ClamAV scheduled scan (2x daily via cron)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
LOG="/home/coder/.claude/clamav-scan.log"
mkdir -p "$(dirname "$LOG")"
echo "" >> "$LOG"
echo "[$TIMESTAMP] Scheduled scan started" >> "$LOG"
RESULT=$(clamscan -r /repo --no-summary 2>/dev/null || true)
echo "$RESULT" >> "$LOG"
FOUND=$(echo "$RESULT" | grep "FOUND" || true)
if [[ -n "$FOUND" ]]; then
    echo "[$TIMESTAMP] ⚠ MALWARE: $FOUND" >> "$LOG"
fi
echo "[$TIMESTAMP] Scan complete" >> "$LOG"
