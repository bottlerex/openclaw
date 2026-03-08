#!/usr/bin/env bash
# Post-deployment 24h security check for #29/#30
# Run manually after 24h monitoring period
set -euo pipefail

echo "=== OpenClaw Security Check (24h post-deploy) ==="
echo ""

echo "[1] Squid access log (last 20 entries)"
docker exec openclaw-squid-proxy cat /var/log/squid/access.log | tail -20
echo ""

echo "[2] Proxy/error logs from agent"
docker logs openclaw-agent --since 24h 2>&1 | grep -iE "error|proxy|denied|fallback" | tail -20 || echo "  (none)"
echo ""

echo "[3] SSH fallback usage (should be 0)"
FALLBACK=$(cat ~/openclaw/config/logs/exec-audit.jsonl 2>/dev/null | grep ssh-fallback | wc -l | tr -d ' ')
echo "  SSH fallback count: $FALLBACK"
echo ""

echo "[4] Container health"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "openclaw|squid"
echo ""

if [ "$FALLBACK" -eq 0 ]; then
  echo ">>> ALL CLEAR — safe to remove SSH key mount"
  echo "    1. Edit ~/openclaw/docker-compose.yml"
  echo "    2. Remove: ./ssh-keys:/home/node/.ssh:ro"
  echo "    3. cd ~/openclaw && docker compose up -d"
  echo "    4. curl -X PATCH http://100.76.67.49:8001/api/backlog/30/status -H 'Content-Type: application/json' -d '{\"status\":\"done\"}'"
else
  echo ">>> WARNING: SSH fallback was used $FALLBACK times. Investigate before removing SSH."
fi
