#!/bin/bash
# OpenClaw P0.1 & P0.2 Auto-Recovery: Telegram stuck & 409 conflict
# Monitors Telegram health-monitor and handles recovery

set -e

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/telegram-auto-recover.log"
HEALTH_CHECK_INTERVAL=5  # seconds
MAX_STUCK_COUNT=2        # reboot after 2 consecutive stuck events

# Logging
log() {
  local timestamp=$(date '+%Y-%m-%dT%H:%M:%S.000Z')
  echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

# Health check: Look for P0 errors in recent logs
check_p0_errors() {
  local error_count=$(docker logs "$CONTAINER_NAME" --since 1m 2>/dev/null | grep -c "health-monitor.*stuck\|409: Conflict" || true)
  echo "$error_count"
}

# Graceful Telegram restart via container restart
# (Since no HTTP API available, we use container-level recovery)
recover_telegram() {
  log "🔧 Attempting Telegram provider recovery..."

  # Step 1: Soft restart (restart container)
  log "  → Container restart..."
  docker restart "$CONTAINER_NAME" 2>&1 | head -5
  sleep 10  # Wait for container to stabilize

  # Step 2: Verify health
  log "  → Health verification..."
  if curl -s http://localhost:18789/health | grep -q '"ok":true'; then
    log "  ✅ Telegram recovery successful"
    return 0
  else
    log "  ⚠️  Health check inconclusive, monitoring next cycle"
    return 1
  fi
}

# Main loop
log "=== Telegram Auto-Recovery Started ==="
log "Container: $CONTAINER_NAME"
log "Monitoring interval: ${HEALTH_CHECK_INTERVAL}s"

stuck_count=0
while true; do
  error_count=$(check_p0_errors)

  if [ "$error_count" -gt 0 ]; then
    stuck_count=$((stuck_count + 1))
    log "⚠️  P0 errors detected in last 1 minute: $error_count (count: $stuck_count)"

    # After 2 detections, execute recovery
    if [ "$stuck_count" -ge "$MAX_STUCK_COUNT" ]; then
      log "🚨 P0 threshold reached, executing recovery..."
      recover_telegram
      stuck_count=0  # Reset counter
    fi
  else
    # Reset counter if no errors
    if [ "$stuck_count" -gt 0 ]; then
      log "✅ No P0 errors detected, resetting counter"
    fi
    stuck_count=0
  fi

  sleep "$HEALTH_CHECK_INTERVAL"
done
