#!/bin/bash
# OpenClaw 設備配對自動批准腳本
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
set -e

PENDING_FILE="/Users/rexmacmini/openclaw/config/devices/pending.json"
LOG_FILE="/tmp/openclaw-pair.log"
GATEWAY_TOKEN="gorj_VLdDiGYnEczyxSYu0tm-UvlDz6dQSvZs60MvGk"
GATEWAY_URL="ws://127.0.0.1:18788"

if [ ! -f "$PENDING_FILE" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') [SKIP] pending.json not found" >> "$LOG_FILE"
  exit 0
fi

PENDING_COUNT=$(jq 'length' "$PENDING_FILE" 2>/dev/null || echo 0)
[ "$PENDING_COUNT" -eq 0 ] && exit 0

jq -r 'to_entries[] | select(.value.clientMode == "webchat") | .value.requestId' "$PENDING_FILE" 2>/dev/null | while read -r REQ_ID; do
  [ -z "$REQ_ID" ] && continue
  if docker exec openclaw-agent openclaw devices approve "$REQ_ID" \
      --token "$GATEWAY_TOKEN" \
      --url "$GATEWAY_URL" 2>&1 > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [APPROVED] $REQ_ID" >> "$LOG_FILE"
  else
    echo "$(date '+%Y-%m-%d %H:%M:%S') [FAILED] $REQ_ID" >> "$LOG_FILE"
  fi
done
