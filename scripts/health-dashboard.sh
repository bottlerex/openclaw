#!/bin/bash
# OpenClaw Health Dashboard: Monitoring + Telegram alerts
# Generates hourly health reports and sends to Telegram

set -e

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/health-dashboard.log"
CHECK_INTERVAL=3600  # 1 hour
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"  # Set via env or config
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

log() {
  local timestamp=$(date '+%Y-%m-%dT%H:%M:%S.000Z')
  echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

# Get container health
get_container_health() {
  docker inspect "$CONTAINER_NAME" --format='{{.State.Health.Status}}' 2>/dev/null || echo "unknown"
}

# Get resource usage
get_resource_stats() {
  docker stats "$CONTAINER_NAME" --no-stream --format "table {{.CPUPerc}}\t{{.MemPerc}}\t{{.NetIO}}" 2>/dev/null || echo "N/A"
}

# Count P0 errors in last hour
count_p0_errors() {
  docker logs "$CONTAINER_NAME" --since 1h 2>/dev/null | \
    grep -c "health-monitor.*stuck\|409: Conflict\|code=1006\|exec.*denied\|timeout: not found" || true
}

# Count recoveries in last hour
count_recoveries() {
  docker logs "$CONTAINER_NAME" --since 1h 2>/dev/null | \
    grep -c "starting provider\|restarting\|reconnecting" || true
}

# Generate report
generate_report() {
  local health=$(get_container_health)
  local p0_count=$(count_p0_errors)
  local recovery_count=$(count_recoveries)
  local timestamp=$(date '+%Y-%m-%dT%H:%M:%SZ')

  cat << EOF
═══════════════════════════════════════
OpenClaw Health Report
═══════════════════════════════════════
Time: $timestamp

Container Status: $health
Resource Usage: $(get_resource_stats)

P0 Errors (last 1h): $p0_count
Recoveries (last 1h): $recovery_count

Issues:
$([ "$p0_count" -gt 0 ] && docker logs "$CONTAINER_NAME" --since 1h 2>/dev/null | grep "error\|ERROR\|failed" | tail -3 || echo "  ✅ No errors detected")

Uptime: $(docker inspect "$CONTAINER_NAME" --format='{{.State.StartedAt}}' 2>/dev/null)
═══════════════════════════════════════
EOF
}

# Send to Telegram (if configured)
send_telegram_alert() {
  local message=$1
  local severity=$2

  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    log "⚠️  Telegram not configured, skipping alert"
    return
  fi

  local emoji="ℹ️"
  case "$severity" in
    "ERROR") emoji="🔴" ;;
    "WARN")  emoji="🟡" ;;
    "INFO")  emoji="ℹ️" ;;
  esac

  # URL encode message
  local encoded_msg=$(echo "$message" | jq -sRr @uri)

  # Send via Telegram API
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"$TELEGRAM_CHAT_ID\", \"text\": \"$emoji $message\"}" \
    > /dev/null 2>&1 || log "⚠️  Failed to send Telegram alert"
}

log "=== Health Dashboard Started ==="
log "Container: $CONTAINER_NAME"
log "Report interval: ${CHECK_INTERVAL}s (1 hour)"

while true; do
  log "📊 Generating health report..."

  report=$(generate_report)
  log "$report"

  # Determine if alert is needed
  p0_count=$(count_p0_errors)
  if [ "$p0_count" -gt 5 ]; then
    send_telegram_alert "🚨 OpenClaw P0 Alert: $p0_count errors in last hour" "ERROR"
  elif [ "$p0_count" -gt 0 ]; then
    send_telegram_alert "OpenClaw status: $p0_count P0 events, $recovery_count recoveries" "WARN"
  else
    send_telegram_alert "✅ OpenClaw healthy: No P0 errors, system nominal" "INFO"
  fi

  sleep "$CHECK_INTERVAL"
done
