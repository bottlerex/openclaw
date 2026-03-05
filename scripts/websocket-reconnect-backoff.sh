#!/bin/bash
# P0.3 修復: WebSocket reconnect backoff strategy
# 實現指數退避重連邏輯，避免過度重連

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/websocket-reconnect.log"
MAX_RETRIES=5
INITIAL_DELAY=2  # 秒

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" >> "$LOG_FILE"
}

# 檢查最近 5 分鐘的斷線
check_frequent_disconnects() {
  local count=$(docker logs "$CONTAINER_NAME" --since 5m 2>/dev/null | grep -c "1006\|disconnect" || true)
  echo "$count"
}

# 指數退避重連
backoff_reconnect() {
  local attempt=$1
  if [ $attempt -gt $MAX_RETRIES ]; then
    log "❌ Max retries ($MAX_RETRIES) exceeded, giving up"
    return 1
  fi
  
  local delay=$((INITIAL_DELAY * (2 ** (attempt - 1))))
  log "🔄 Reconnect attempt $attempt/$MAX_RETRIES (delay: ${delay}s)"
  
  sleep $delay
  
  # Try to restart gateway/websocket component
  docker exec "$CONTAINER_NAME" kill -9 $(pgrep -f gateway) 2>/dev/null || true
  log "  → Gateway process reset"
  
  return 0
}

# Main
log "=== WebSocket Reconnect Backoff Started ==="

DISCONNECT_COUNT=$(check_frequent_disconnects)
if [ "$DISCONNECT_COUNT" -gt 3 ]; then
  log "⚠️  Frequent disconnects detected: $DISCONNECT_COUNT in last 5m"
  
  for attempt in $(seq 1 $MAX_RETRIES); do
    if backoff_reconnect $attempt; then
      CURRENT=$(check_frequent_disconnects)
      if [ "$CURRENT" -lt $DISCONNECT_COUNT ]; then
        log "✅ Reconnection successful (errors reduced)"
        exit 0
      fi
    fi
  done
else
  log "✅ Disconnect rate normal"
fi
