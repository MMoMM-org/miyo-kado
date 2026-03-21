#!/bin/bash
# ClamAV database update (2x daily via cron)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
LOG="/home/coder/.claude/clamav-update.log"
echo "[$TIMESTAMP] freshclam update..." >> "$LOG"
freshclam --quiet 2>&1 >> "$LOG" || echo "[$TIMESTAMP] Update failed" >> "$LOG"
