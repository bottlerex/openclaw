#!/bin/bash
# OpenClaw Log Anomaly Detection & Alerts
# Runs hourly, detects issues, triggers notifications

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/log-anomaly-alerts.log"
ALERT_THRESHOLD=3  # Alert if 3+ errors in 1 hour

log() {
  local timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

# Alert levels
alert_critical() {
  local msg=$1
  log "🔴 CRITICAL: $msg"
  # TODO: Send Telegram notification (Phase 4)
}

alert_warning() {
  local msg=$1
  log "🟡 WARNING: $msg"
  # TODO: Send Telegram notification
}

alert_info() {
  local msg=$1
  log "ℹ️  INFO: $msg"
}

# Analyze logs for anomalies
analyze_logs() {
  local window="1h"
  local logs=$(docker logs "$CONTAINER_NAME" --since "$window" 2>/dev/null)

  # Define anomaly patterns
  local patterns=(
    "error|ERROR|failed|FAILED"
    "timeout|TIMEOUT"
    "exception|Exception"
    "panic|Panic"
    "out of memory|OOM"
    "connection refused"
    "Too many open files"
  )

  log "=== Analyzing logs (last $window) ==="

  for pattern in "${patterns[@]}"; do
    local count=$(echo "$logs" | grep -ic "$pattern" || true)

    if [ "$count" -gt 0 ]; then
      if [ "$count" -ge "$ALERT_THRESHOLD" ]; then
        alert_critical "Pattern '$pattern': $count occurrences (threshold: $ALERT_THRESHOLD)"
      else
        alert_warning "Pattern '$pattern': $count occurrences"
      fi
    fi
  done

  # Specific P0 checks
  local p0_count=$(echo "$logs" | grep -Ec "health-monitor.*stuck|409: Conflict|code=1006" || true)
  if [ "$p0_count" -gt 0 ]; then
    alert_critical "P0 Events Detected: $p0_count"
  else
    alert_info "P0 check: ✅ clean"
  fi
}

# Memory usage check
check_memory() {
  log ""
  log "=== Resource Check ==="

  local mem_percent=$(docker stats "$CONTAINER_NAME" --no-stream --format "{{.MemPerc}}" 2>/dev/null | sed 's/%//')

  if (( $(echo "$mem_percent > 85" | bc -l 2>/dev/null || echo 0) )); then
    alert_critical "Memory usage high: ${mem_percent}%"
  elif (( $(echo "$mem_percent > 70" | bc -l 2>/dev/null || echo 0) )); then
    alert_warning "Memory usage elevated: ${mem_percent}%"
  else
    alert_info "Memory: ${mem_percent}% ✅"
  fi
}

# Container health check
check_container_health() {
  log ""
  log "=== Container Health ==="

  local health=$(docker inspect "$CONTAINER_NAME" --format='{{.State.Health.Status}}' 2>/dev/null)

  if [ "$health" != "healthy" ]; then
    alert_critical "Container health: $health"
  else
    alert_info "Container health: ✅ healthy"
  fi
}

# Main execution
log ""
log "Starting hourly log anomaly analysis..."

analyze_logs
check_memory
check_container_health

log ""
log "Analysis completed"
