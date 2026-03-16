#!/bin/bash
# OpenClaw P0 Monitor Dispatcher — Final v3 (macOS compatible)

set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/p0-monitor-dispatcher.log"
TELEGRAM_CHAT="150944774"
RECOVERY_ATTEMPTS=3

log() {
  # macOS compatible date format
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$timestamp] $1" >> "$LOG_FILE"
}

send_telegram() {
  local msg="$1"
  curl -sk -X POST https://localhost:18789/telegram/send \
    -H "Content-Type: application/json" \
    -d "{\"to\": \"$TELEGRAM_CHAT\", \"text\": \"$msg\"}" 2>/dev/null || true
}

# ============ CRITICAL: Check if container is RUNNING ============
IS_RUNNING=$(docker inspect "$CONTAINER_NAME" --format='{{.State.Running}}' 2>/dev/null || echo "false")

if [ "$IS_RUNNING" != "true" ]; then
  log "🚨 P0 CRITICAL: Container $CONTAINER_NAME is NOT RUNNING"
  log "  → Initiating auto-restart sequence..."
  
  attempt=1
  while [ $attempt -le $RECOVERY_ATTEMPTS ]; do
    log "  → Restart attempt $attempt/$RECOVERY_ATTEMPTS"
    
    if docker start "$CONTAINER_NAME" 2>&1 > /dev/null; then
      log "  ✅ docker start succeeded"
      
      sleep 10  # Wait for container to settle
      
      IS_RUNNING=$(docker inspect "$CONTAINER_NAME" --format='{{.State.Running}}' 2>/dev/null || echo "false")
      if [ "$IS_RUNNING" = "true" ]; then
        log "  ✅ Container confirmed RUNNING"
        
        # Wait for gateway health
        for i in {1..10}; do
          if curl -sk https://localhost:18789/ready > /dev/null 2>&1; then
            log "  ✅ Gateway health check PASS"
            send_telegram "✅ OPENCLAW AUTO-RECOVERY SUCCESS\n⏰ Time: $(date)\n✓ Container restarted\n✓ Gateway online"
            exit 0
          fi
          sleep 1
        done
        
        log "  ⚠️  Container running, gateway not ready yet"
        exit 0
      else
        log "  ❌ Container still not running (attempt $attempt)"
      fi
    else
      log "  ❌ docker start failed (attempt $attempt)"
    fi
    
    attempt=$((attempt + 1))
    [ $attempt -le $RECOVERY_ATTEMPTS ] && sleep 5
  done
  
  log "❌ P0 CRITICAL: AUTO-RESTART FAILED after $RECOVERY_ATTEMPTS attempts"
  send_telegram "❌ OPENCLAW P0 CRITICAL: AUTO-RESTART FAILED\n⏰ Time: $(date)\n🔗 Manual intervention required"
  exit 1
fi

# ============ NORMAL MONITORING ============
log "✅ Container running, checking for P0 issues..."

RECENT_LOGS=$(docker logs "$CONTAINER_NAME" --since 5m 2>/dev/null || echo "")

# P0.1: Telegram stuck
if echo "$RECENT_LOGS" | grep -q "health-monitor.*stuck"; then
  log "🚨 P0.1: Telegram health-monitor stuck"
  if docker restart "$CONTAINER_NAME" 2>&1 > /dev/null; then
    log "  ✅ Restarted"
    send_telegram "✅ P0.1: Telegram health-monitor recovered"
  fi
fi

# P0.2: Telegram 409
if echo "$RECENT_LOGS" | grep -q "409: Conflict"; then
  log "🚨 P0.2: Telegram 409 Conflict"
  if docker restart "$CONTAINER_NAME" 2>&1 > /dev/null; then
    sleep 5
    log "  ✅ Restarted"
    send_telegram "✅ P0.2: Telegram 409 Conflict recovered"
  fi
fi

# P0.3: WebSocket 1006 + high memory
if echo "$RECENT_LOGS" | grep -q "code=1006"; then
  log "⚠️  P0.3: WebSocket 1006"
  MEM_PERCENT=$(docker stats "$CONTAINER_NAME" --no-stream --format "{{.MemPerc}}" 2>/dev/null | sed 's/%//' || echo "0")
  
  if (( $(echo "$MEM_PERCENT > 85" | bc -l 2>/dev/null || echo "0") )); then
    log "  → Memory high ($MEM_PERCENT%), restarting"
    if docker restart "$CONTAINER_NAME" 2>&1 > /dev/null; then
      log "  ✅ Restarted"
      send_telegram "✅ P0.3: WebSocket memory leak recovered (${MEM_PERCENT}%)"
    fi
  else
    log "  → Memory OK ($MEM_PERCENT%)"
  fi
fi

# P0.4: Tools issue
if echo "$RECENT_LOGS" | grep -qE "exec.*denied|timeout: not found"; then
  log "⚠️  P0.4: Tool execution issue (requires code fix)"
fi

# Final check
if curl -sk https://localhost:18789/ready > /dev/null 2>&1; then
  log "✅ Health check: PASS"
else
  log "⚠️  Health check: No response"
fi

exit 0

# ============ CONFIG INTEGRITY CHECK ============
CONFIG_FILE="$HOME/openclaw/config/openclaw.json"
CONFIG_SNAPSHOT="$HOME/openclaw/config/.openclaw-config-snapshot"

if [ -f "$CONFIG_FILE" ]; then
  # Check critical fields exist
  MISSING=""
  python3 -c "
import json, sys
c = json.load(open(\"$CONFIG_FILE\"))
required = [
  (\"gateway.auth.token\", c.get(\"gateway\",{}).get(\"auth\",{}).get(\"token\")),
  (\"channels\", c.get(\"channels\")),
  (\"plugins\", c.get(\"plugins\")),
]
missing = [k for k,v in required if not v]
if missing:
  print(\",\".join(missing))
  sys.exit(1)
" 2>/dev/null
  RC=$?
  if [ $RC -ne 0 ]; then
    MISSING_FIELDS=$(python3 -c "
import json, sys
c = json.load(open(\"$CONFIG_FILE\"))
required = [
  (\"gateway.auth.token\", c.get(\"gateway\",{}).get(\"auth\",{}).get(\"token\")),
  (\"channels\", c.get(\"channels\")),
  (\"plugins\", c.get(\"plugins\")),
]
print(\",\".join([k for k,v in required if not v]))
" 2>/dev/null)
    log "🚨 CONFIG INTEGRITY FAIL: missing fields: $MISSING_FIELDS"
    send_telegram "🚨 CONFIG INTEGRITY ALERT\nMissing: $MISSING_FIELDS\nRestoring from git..."
    cd "$HOME/openclaw" && git checkout -- config/openclaw.json 2>/dev/null
    log "  → Restored config from git HEAD"
    docker restart "$CONTAINER_NAME" 2>/dev/null
  fi

  # Check PRIMARY_MODEL env
  HAS_MODEL=$(docker exec "$CONTAINER_NAME" printenv OPENCLAW_PRIMARY_MODEL 2>/dev/null)
  if [ -z "$HAS_MODEL" ]; then
    log "🚨 OPENCLAW_PRIMARY_MODEL missing from container env"
    send_telegram "🚨 OPENCLAW_PRIMARY_MODEL missing — container may need restart with correct env"
  fi
fi
