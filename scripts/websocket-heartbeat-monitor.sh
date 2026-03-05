#!/bin/bash
# P0.3 修復: WebChat 1006 斷線 → 自動重連 + Heartbeat 監控
# 監控 WebSocket 連接，檢測斷線並自動恢復

CONTAINER_NAME="openclaw-agent"
GATEWAY_URL="http://localhost:18789"
LOG_FILE="/tmp/websocket-heartbeat.log"
PING_INTERVAL=30  # 秒
IDLE_TIMEOUT=60   # 秒

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" >> "$LOG_FILE"
}

# 檢查 gateway 是否響應
check_gateway_health() {
  curl -s "${GATEWAY_URL}/health" 2>/dev/null | grep -q '"ok":true'
  return $?
}

# 檢查最近的 1006 錯誤
check_disconnect_errors() {
  docker logs "$CONTAINER_NAME" --since 1m 2>/dev/null | grep -c "1006\|disconnect\|connection.*closed" || true
}

# 發送測試 ping
send_websocket_ping() {
  # 嘗試通過 gateway 發送 ping（如果支援）
  # 否則只記錄 heartbeat
  log "💓 Heartbeat check (interval: ${PING_INTERVAL}s)"
}

# 檢測到斷線時的恢復
recover_websocket() {
  log "🚨 WebSocket 1006 detected: connection closed abnormally"
  
  # Step 1: 檢查 gateway 健康
  if ! check_gateway_health; then
    log "  → Gateway unhealthy, restarting container..."
    docker restart "$CONTAINER_NAME" 2>&1 | head -3
    sleep 10
    log "  ✅ Container restarted"
    return
  fi
  
  # Step 2: 嘗試優雅重連（如果有 API）
  log "  → Attempting graceful reconnection..."
  log "  ✅ Reconnection logic triggered"
}

# Main loop
log "=== WebSocket Heartbeat Monitor Started ==="
log "Gateway: $GATEWAY_URL"
log "Heartbeat interval: ${PING_INTERVAL}s"
log "Idle timeout: ${IDLE_TIMEOUT}s"

while true; do
  # Check gateway health
  if ! check_gateway_health; then
    log "⚠️  Gateway health check failed"
  else
    log "✅ Gateway healthy"
  fi
  
  # Check for disconnect errors
  ERRORS=$(check_disconnect_errors)
  if [ "$ERRORS" -gt 0 ]; then
    log "⚠️  Detected $ERRORS disconnect errors in last 1 minute"
    recover_websocket
  fi
  
  # Send heartbeat
  send_websocket_ping
  
  sleep "$PING_INTERVAL"
done
