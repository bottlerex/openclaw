#!/bin/bash
# OpenClaw P0 Monitor Dispatcher
# Runs every 5 minutes to check for P0 errors and dispatch recoveries
# This is simpler than running 4 separate continuous processes

set -e

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/p0-monitor-dispatcher.log"
SCRIPT_DIR="/Users/rexmacmini/openclaw/scripts"

log() {
  local timestamp=$(date '+%Y-%m-%dT%H:%M:%S.000Z')
  echo "[$timestamp] $1" >> "$LOG_FILE"
}

# Check if container is running
if ! docker inspect "$CONTAINER_NAME" > /dev/null 2>&1; then
  log "❌ Container $CONTAINER_NAME not running, exiting"
  exit 1
fi

# Get recent logs
RECENT_LOGS=$(docker logs "$CONTAINER_NAME" --since 5m 2>/dev/null || echo "")

# P0.1: Telegram stuck
if echo "$RECENT_LOGS" | grep -q "health-monitor.*stuck"; then
  log "🚨 P0.1 Detected: Telegram health-monitor stuck"
  log "  → Executing telegram recovery..."
  docker restart "$CONTAINER_NAME" 2>&1 | head -3
  log "  ✅ Container restarted"
fi

# P0.2: Telegram 409 conflict
if echo "$RECENT_LOGS" | grep -q "409: Conflict"; then
  log "🚨 P0.2 Detected: Telegram 409 conflict"
  log "  → Executing telegram recovery..."
  docker restart "$CONTAINER_NAME" 2>&1 | head -3
  sleep 5
  log "  ✅ Container restarted"
fi

# P0.3: WebSocket 1006
if echo "$RECENT_LOGS" | grep -q "code=1006"; then
  log "⚠️  P0.3 Detected: WebSocket disconnect code=1006"
  # Check memory usage
  MEM_PERCENT=$(docker stats "$CONTAINER_NAME" --no-stream --format "{{.MemPerc}}" 2>/dev/null | sed 's/%//' || echo "0")
  if (( $(echo "$MEM_PERCENT > 80" | bc -l 2>/dev/null || echo "0") )); then
    log "  → Memory usage high ($MEM_PERCENT%), restarting container"
    docker restart "$CONTAINER_NAME" 2>&1 | head -3
  else
    log "  → Memory normal ($MEM_PERCENT%), client-side reconnection expected"
  fi
fi

# P0.4: Tools allowlist miss + timeout not found
if echo "$RECENT_LOGS" | grep -qE "exec.*denied|timeout: not found"; then
  log "⚠️  P0.4 Detected: Tool execution denied or timeout command missing"
  log "  → Action: timeout command must be installed in Docker image"
  log "  → Temporary: Review logs at docker logs $CONTAINER_NAME"
fi

# Health check
if curl -s http://localhost:18789/health 2>/dev/null | grep -q '"ok":true'; then
  log "✅ Container health: OK"
else
  log "⚠️  Container health check inconclusive"
fi
