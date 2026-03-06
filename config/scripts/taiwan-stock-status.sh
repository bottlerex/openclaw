#!/usr/bin/env bash
# OpenClaw host script: taiwan-stock-status.sh
# Purpose: Taiwan Stock MVP system status check
# Usage: taiwan-stock-status.sh [--json] [--detailed]

set -euo pipefail

json_mode=0
detailed=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      json_mode=1
      shift
      ;;
    --detailed)
      detailed=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Check containers
echo "Checking Taiwan Stock MVP containers..." >&2

frontend_status=$(docker ps --filter "name=taiwan-stock-frontend" --format "{{.State}}" || echo "unknown")
backend_status=$(docker ps --filter "name=taiwan-stock-backend" --format "{{.State}}" || echo "unknown")
postgres_status=$(docker ps --filter "name=taiwan-stock-postgres" --format "{{.State}}" || echo "unknown")
redis_status=$(docker ps --filter "name=taiwan-stock-redis" --format "{{.State}}" || echo "unknown")

# Quick API check
api_check=$(curl -s -w "%{http_code}" -o /dev/null http://localhost:8000/health || echo "0")

# Database connectivity
db_check=""
if [[ "$postgres_status" == "running" ]]; then
  if psql -U postgres -d stock_db -h localhost -c "SELECT 1" > /dev/null 2>&1; then
    db_check="✓"
  else
    db_check="✗"
  fi
else
  db_check="N/A"
fi

if [[ $json_mode -eq 1 ]]; then
  cat <<EOJSON
{
  "containers": {
    "frontend": "$frontend_status",
    "backend": "$backend_status",
    "postgres": "$postgres_status",
    "redis": "$redis_status"
  },
  "api_health": $api_check,
  "database_connectivity": "$db_check",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOJSON
else
  cat <<EOTEXT
Taiwan Stock MVP Status ($(date '+%Y-%m-%d %H:%M:%S'))
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Containers:
  Frontend:  $frontend_status
  Backend:   $backend_status
  PostgreSQL: $postgres_status
  Redis:     $redis_status

Connectivity:
  API Health (HTTP $api_check)
  Database:  $db_check
EOTEXT
fi

if [[ $detailed -eq 1 ]]; then
  echo ""
  echo "=== Detailed Logs ==="
  echo "Backend recent logs:"
  docker logs --tail 10 taiwan-stock-backend 2>/dev/null || echo "N/A"
fi
