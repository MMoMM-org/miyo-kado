#!/bin/bash
# init-firewall.sh — Container network firewall setup (secure variant)
#
# Called from entrypoint.sh via: sudo /usr/local/bin/claude-scripts/init-firewall.sh
# Requires: NET_ADMIN cap (--cap-add NET_ADMIN in docker run)
# Reads:    CLAUDE_REGISTRY_DEFAULT, CLAUDE_REGISTRY_REPO env vars
#
# Three-layer approach:
#   1. Disable IPv6 (prevent bypass via v6 addresses)
#   2. Build ipset allowlist from registry firewall_allow config
#   3. Apply iptables: ACCEPT allowlist, DROP all other outbound

set -eu

STATE_FILE="/var/lib/firewall-configured"
IPSET_NAME="allowed-domains"

# Idempotency guard (within a single container run)
if [ -f "$STATE_FILE" ]; then
  exit 0
fi

echo "[init-firewall] Configuring network firewall..."

# ── Registry paths ──────────────────────────────────────────────────────
DEFAULT_REGISTRY="${CLAUDE_REGISTRY_DEFAULT:-/home/coder/Kouzou/registries/default-registry.json}"
REPO_REGISTRY="${CLAUDE_REGISTRY_REPO:-}"

# ── Build merged firewall_allow JSON ────────────────────────────────────
if [ ! -f "$DEFAULT_REGISTRY" ]; then
  echo "[init-firewall] Warning: no registry found at $DEFAULT_REGISTRY — allowing all traffic"
  exit 0
fi

if [ -n "$REPO_REGISTRY" ] && [ -f "$REPO_REGISTRY" ]; then
  FIREWALL_JSON=$(jq -s '
    .[0].firewall_allow as $base |
    .[1].firewall_allow as $repo |
    reduce (($repo // {}) | keys[]) as $k (
      ($base // {});
      .[$k] = ((.[$k] // []) + ($repo[$k] // []))
    )
  ' "$DEFAULT_REGISTRY" "$REPO_REGISTRY" 2>/dev/null || echo '{}')
else
  FIREWALL_JSON=$(jq '.firewall_allow // {}' "$DEFAULT_REGISTRY" 2>/dev/null || echo '{}')
fi

# ── Helpers ─────────────────────────────────────────────────────────────

_fetch_github() {
  curl -sf --max-time 15 https://api.github.com/meta 2>/dev/null \
    | jq -r '(.web // []) + (.api // []) + (.git // []) + (.actions // []) | .[]' 2>/dev/null \
    || echo "140.82.112.0/20"
}

_fetch_anthropic() {
  echo "160.79.104.0/23"
}

_resolve_domain() {
  local domain="$1"
  if command -v getent >/dev/null 2>&1; then
    getent ahosts "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true
  else
    nslookup "$domain" 2>/dev/null | awk '/^Address:/{print $2}' | grep -v ':' || true
  fi
}

_ipset_add_cidr_or_domain() {
  local entry="$1"
  case "$entry" in
    */*) ipset add "$IPSET_NAME" "$entry" 2>/dev/null || true ;;
    *)
      while IFS= read -r ip; do
        [ -z "$ip" ] && continue
        ipset add "$IPSET_NAME" "$ip/32" 2>/dev/null || true
      done < <(_resolve_domain "$entry")
      ;;
  esac
}

_add_registry_key() {
  local key="$1"
  while IFS= read -r entry; do
    [ -z "$entry" ] && continue
    _ipset_add_cidr_or_domain "$entry"
  done < <(printf '%s' "$FIREWALL_JSON" | jq -r --arg k "$key" '.[$k] // [] | .[]' 2>/dev/null || true)
}

# ── 1. Disable IPv6 ─────────────────────────────────────────────────────
if command -v sysctl >/dev/null 2>&1; then
  sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null 2>&1 \
    || echo "[init-firewall] Warning: sysctl IPv6 disable failed (continuing)"
  sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null 2>&1 || true
fi

# ── 2. Build ipset allowlist ────────────────────────────────────────────
ipset destroy "$IPSET_NAME" 2>/dev/null || true
ipset create "$IPSET_NAME" hash:net

# Add Docker internal ranges (loopback handled separately by iptables)
for docker_net in 172.16.0.0/12 10.0.0.0/8; do
  ipset add "$IPSET_NAME" "$docker_net" 2>/dev/null || true
done

# Base CIDRs from registry
_add_registry_key "base"

# Dynamic providers
while IFS= read -r provider; do
  [ -z "$provider" ] && continue
  case "$provider" in
    github)
      echo "[init-firewall] Fetching GitHub IP ranges..."
      while IFS= read -r cidr; do
        [ -z "$cidr" ] && continue
        ipset add "$IPSET_NAME" "$cidr" 2>/dev/null || true
      done < <(_fetch_github)
      ;;
    anthropic)
      while IFS= read -r cidr; do
        [ -z "$cidr" ] && continue
        ipset add "$IPSET_NAME" "$cidr" 2>/dev/null || true
      done < <(_fetch_anthropic)
      ;;
    *)
      echo "[init-firewall] Unknown dynamic provider: $provider (skipping)"
      ;;
  esac
done < <(printf '%s' "$FIREWALL_JSON" | jq -r '.fetch_dynamic // [] | .[]' 2>/dev/null || true)

# Extra domains
_add_registry_key "extra_domains"

# All mcp_* and plugin_* keys
while IFS= read -r key; do
  [ -z "$key" ] && continue
  echo "[init-firewall] Adding domains for: $key"
  _add_registry_key "$key"
done < <(printf '%s' "$FIREWALL_JSON" | jq -r 'keys[] | select(startswith("mcp_") or startswith("plugin_"))' 2>/dev/null || true)

ENTRY_COUNT=$(ipset list "$IPSET_NAME" 2>/dev/null | grep -c '^[0-9]' || echo 0)
echo "[init-firewall] Allowlist: $ENTRY_COUNT entries"

# ── 3. Apply iptables rules ─────────────────────────────────────────────
# Allow Docker DNS
iptables -A OUTPUT -d 127.0.0.11 -j ACCEPT 2>/dev/null || true

# Allow established/related (must come before DROP)
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT

# Allow ipset allowlist
iptables -A OUTPUT -m set --match-set "$IPSET_NAME" dst -j ACCEPT

# Default DROP all other outbound
iptables -P OUTPUT DROP

# ── Write state file ────────────────────────────────────────────────────
mkdir -p /var/lib
touch "$STATE_FILE"

echo "[init-firewall] Firewall active. OUTPUT policy: DROP + allowlist."
