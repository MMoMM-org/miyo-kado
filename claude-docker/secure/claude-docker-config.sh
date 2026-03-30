#!/bin/bash
# claude-docker-config.sh — Secure variant docker run flags
# Sourced by begin-code.sh. Sets DOCKER_FLAGS array.

DOCKER_FLAGS=(
  "--cap-drop" "ALL"
  "--cap-add" "CHOWN"
  "--cap-add" "DAC_OVERRIDE"
  "--cap-add" "NET_ADMIN"
  "--security-opt" "no-new-privileges:true"
  "--memory" "2g"
  "--cpus" "2"
)

# Runs as root before entrypoint drops to coder user.
# Firewall needs root for iptables — sudo is blocked by no-new-privileges.
DOCKER_ENTRYPOINT_PREFIX="/usr/local/bin/claude-scripts/crontab-setup.sh 2>/dev/null; /usr/local/bin/claude-scripts/init-firewall.sh 2>/dev/null;"
