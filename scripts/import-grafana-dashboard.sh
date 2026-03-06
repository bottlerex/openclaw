#!/bin/bash

# Grafana Dashboard Import Script
# Usage: ./import-grafana-dashboard.sh [grafana_url] [username] [password]

GRAFANA_URL="${1:-http://127.0.0.1:3000}"
USERNAME="${2:-admin}"
PASSWORD="${3:-admin}"
DASHBOARD_FILE="/Users/rexmacmini/openclaw/config/grafana-rag-dashboard.json"

echo "🚀 Importing OpenClaw RAG Dashboard to $GRAFANA_URL"

# Get API token
echo "获取 API Token..."
TOKEN=$(curl -s -X POST "$GRAFANA_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"user\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" | jq -r '.token')

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
  echo "❌ Failed to authenticate. Check credentials."
  exit 1
fi

echo "✅ Authentication successful"

# Import dashboard
echo "Importing dashboard..."
curl -s -X POST "$GRAFANA_URL/api/dashboards/db" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @"$DASHBOARD_FILE" | jq .

echo "✅ Dashboard import complete"
