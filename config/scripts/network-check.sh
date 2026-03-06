#!/usr/bin/env bash
# OpenClaw host script: network-check.sh
# Purpose: Network diagnostics (connectivity, DNS, latency)
# Usage: network-check.sh [--target HOST] [--json]

set -euo pipefail

target="8.8.8.8"
json_mode=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      target="$2"
      shift 2
      ;;
    --json)
      json_mode=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Test connectivity
ping_result=$(ping -c 1 -W 2 "$target" 2>&1 | grep "time=" | tail -1 | awk '{print $NF}' || echo "timeout")
dns_result=$(dig +short google.com @8.8.8.8 | head -1 || echo "failed")
local_ip=$(ifconfig | grep "inet " | grep -v "127.0.0.1" | awk '{print $2}' | head -1)

if [[ $json_mode -eq 1 ]]; then
  cat <<EOJSON
{
  "ping_latency": "$ping_result",
  "dns_lookup": "$dns_result",
  "local_ip": "$local_ip",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOJSON
else
  cat <<EOTEXT
Network Status ($(date '+%Y-%m-%d %H:%M:%S'))
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ping Latency:  $ping_result
DNS Lookup:    $dns_result
Local IP:      $local_ip
EOTEXT
fi
