#!/bin/bash
# Called on container start — registers cron jobs and starts cron daemon

(crontab -l 2>/dev/null || true; cat << 'CRON'
# ClamAV DB update 2x daily (06:00 and 18:00)
0 6,18 * * * /usr/local/bin/claude-scripts/clam-update.sh
# ClamAV scan 2x daily (06:30 and 18:30)
30 6,18 * * * /usr/local/bin/claude-scripts/clam-scan.sh
# Session cleanup 3x daily (08:00, 13:00, 20:00)
0 8,13,20 * * * /usr/local/bin/claude-scripts/session-cleanup.sh
CRON
) | sort -u | crontab -

# Start cron daemon (as root process inside container)
cron 2>/dev/null || true
echo "[INFO] Cron jobs registered and cron started"
