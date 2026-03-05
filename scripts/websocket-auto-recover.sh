#!/bin/bash
# OpenClaw P0.3 Auto-Recovery: WebSocket 1006 disconnect
# Monitors WebSocket health and triggers client-side reconnection guidance

set -e

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/websocket-auto-recover.log"
CHECK_INTERVAL=10  # seconds

log() {
  local timestamp=$(date '+%Y-%m-%dT%H:%M:%S.000Z')
  echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

# Check for WebSocket 1006 errors
check_ws_errors() {
  local error_count=$(docker logs "$CONTAINER_NAME" --since 2m 2>/dev/null | grep -c "code=1006\|disconnect" || true)
  echo "$error_count"
}

# Check for memory leaks
check_memory_usage() {
  local memory_percent=$(docker stats "$CONTAINER_NAME" --no-stream --format "{{.MemPerc}}" 2>/dev/null | sed 's/%//')
  # Return 1 if memory usage > 80%
  if (( $(echo "$memory_percent > 80" | bc -l) )); then
    echo "high"
  else
    echo "ok"
  fi
}

# Perform recovery
recover_websocket() {
  log "🔧 Attempting WebSocket recovery..."

  local memory_status=$(check_memory_usage)

  if [ "$memory_status" = "high" ]; then
    log "  → High memory detected ($memory_status), restarting container..."
    docker restart "$CONTAINER_NAME" 2>&1 | head -5
    sleep 10
  else
    log "  → Memory normal, waiting for client-side reconnection..."
    log "  → (Clients should use exponential backoff: 1s, 2s, 4s, 8s, 16s...)"
  fi

  # Verify health
  if curl -s http://localhost:18789/health | grep -q '"ok":true'; then
    log "  ✅ Gateway is healthy"
    return 0
  else
    log "  ⚠️  Gateway health check failed, may need manual intervention"
    return 1
  fi
}

log "=== WebSocket Auto-Recovery Started ==="
log "Container: $CONTAINER_NAME"
log "Check interval: ${CHECK_INTERVAL}s"

ws_error_count=0
while true; do
  error_count=$(check_ws_errors)

  if [ "$error_count" -gt 2 ]; then
    ws_error_count=$((ws_error_count + 1))
    log "⚠️  WebSocket errors in last 2 minutes: $error_count (occurrence: $ws_error_count)"

    if [ "$ws_error_count" -ge 2 ]; then
      log "🚨 Multiple WebSocket disconnects detected, executing recovery..."
      recover_websocket
      ws_error_count=0
    fi
  else
    if [ "$ws_error_count" -gt 0 ]; then
      log "✅ WebSocket stable, resetting counter"
    fi
    ws_error_count=0
  fi

  sleep "$CHECK_INTERVAL"
done
