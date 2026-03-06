#!/bin/bash
# P0.3 WebSocket Stability — Heartbeat + Exponential Backoff + Memory Monitor
# 改進：指數退避重連 + 內存監控 + 優雅恢復

CONTAINER_NAME="openclaw-agent"
GATEWAY_URL="http://localhost:18789"
LOG_FILE="/tmp/websocket-heartbeat.log"
METRICS_FILE="/tmp/websocket-metrics.json"
PING_INTERVAL=30  # 秒
MEMORY_THRESHOLD=1800  # 1.8GB（90% of 2GB）
MAX_BACKOFF=300  # 5 分鐘最大延遲

# 重連狀態
RECONNECT_ATTEMPT=0
BACKOFF_DELAY=1

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" | tee -a "$LOG_FILE"
}

check_gateway_health() {
  timeout 3 curl -s "${GATEWAY_URL}/health" 2>/dev/null | grep -q '"ok":true'
  return $?
}

check_disconnect_errors() {
  docker logs "$CONTAINER_NAME" --since 1m 2>/dev/null | grep -ic "1006\|disconnect\|connection.*closed" || echo 0
}

check_memory_usage() {
  docker stats --no-stream "$CONTAINER_NAME" --format '{{.MemUsage}}' 2>/dev/null | grep -oE '^[0-9]+' || echo 0
}

exponential_backoff() {
  local delay=$((BACKOFF_DELAY * RECONNECT_ATTEMPT))
  if [ $delay -gt $MAX_BACKOFF ]; then
    delay=$MAX_BACKOFF
  fi
  echo $delay
}

recover_websocket() {
  RECONNECT_ATTEMPT=$((RECONNECT_ATTEMPT + 1))
  BACKOFF=$(exponential_backoff)
  
  log "🚨 WebSocket Issue Detected (attempt $RECONNECT_ATTEMPT)"
  log "  → Waiting ${BACKOFF}s before recovery (exponential backoff)"
  
  sleep "$BACKOFF"
  
  # 重啟容器
  log "  → Restarting container..."
  docker restart "$CONTAINER_NAME" >/dev/null 2>&1
  sleep 5
  
  # 驗證恢復
  if check_gateway_health; then
    log "  ✅ Recovery successful, resetting backoff"
    RECONNECT_ATTEMPT=0
    BACKOFF_DELAY=1
  else
    log "  ⚠️  Recovery failed, will retry with longer backoff"
  fi
}

emit_metrics() {
  local mem=$(check_memory_usage)
  local mem_percent=$((mem * 100 / 2000))
  local errors=$(check_disconnect_errors)
  
  cat > "$METRICS_FILE" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "gateway_healthy": $(check_gateway_health && echo 'true' || echo 'false'),
  "memory_mb": $mem,
  "memory_percent": $mem_percent,
  "disconnect_errors_1m": $errors,
  "reconnect_attempts": $RECONNECT_ATTEMPT
}
EOF
}

# Main Loop
log "=== WebSocket Heartbeat Monitor Started (v2) ==="
log "Gateway: $GATEWAY_URL | Interval: ${PING_INTERVAL}s | Metrics: $METRICS_FILE"

while true; do
  # 檢查 gateway
  if ! check_gateway_health; then
    recover_websocket
  else
    # 重設重試計數
    if [ $RECONNECT_ATTEMPT -gt 0 ]; then
      log "✅ Gateway healthy"
      RECONNECT_ATTEMPT=0
    fi
  fi
  
  # 檢查記憶體
  MEM=$(check_memory_usage)
  if [ "$MEM" -gt "$MEMORY_THRESHOLD" ]; then
    log "⚠️  High memory usage: ${MEM}MB (threshold: ${MEMORY_THRESHOLD}MB)"
  fi
  
  # 檢查 1006 錯誤
  ERRORS=$(check_disconnect_errors)
  if [ "$ERRORS" -gt 0 ]; then
    log "⚠️  Detected $ERRORS disconnect events"
    recover_websocket
  fi
  
  # 發送指標
  emit_metrics
  
  sleep "$PING_INTERVAL"
done
