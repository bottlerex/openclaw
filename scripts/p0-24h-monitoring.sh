#!/bin/bash
# OpenClaw P0 24-Hour Monitoring Report
# Runs in background, generates hourly summary

MONITOR_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CONTAINER_NAME="openclaw-agent"
REPORT_FILE="/tmp/p0-24h-report-${MONITOR_START:0:10}.txt"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" | tee -a "$REPORT_FILE"
}

init_report() {
  cat > "$REPORT_FILE" << 'EOF'
╔════════════════════════════════════════════════════════════╗
║     OpenClaw P0 Recovery Monitoring — 24-Hour Report       ║
╚════════════════════════════════════════════════════════════╝

Monitor Start: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Container: openclaw-agent
Phase: Layer 1 Auto-Recovery Verification

─────────────────────────────────────────────────────────────

BASELINE METRICS:
EOF

  # Record baseline
  docker inspect "$CONTAINER_NAME" --format='Container Started: {{.State.StartedAt}}' >> "$REPORT_FILE"
  docker stats "$CONTAINER_NAME" --no-stream --format "Memory: {{.MemPerc}}, CPU: {{.CPUPerc}}" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "Monitoring in progress..." >> "$REPORT_FILE"
}

check_interval() {
  local interval=$1
  local p0_errors=$(docker logs "$CONTAINER_NAME" --since "${interval}m" 2>/dev/null | \
    grep -c "health-monitor.*stuck\|409: Conflict\|code=1006\|exec.*denied" || true)
  local recoveries=$(docker logs "$CONTAINER_NAME" --since "${interval}m" 2>/dev/null | \
    grep -c "starting provider\|restarting\|reconnecting" || true)

  echo "$p0_errors:$recoveries"
}

# Initialize report
init_report
log "Starting 24-hour P0 monitoring"

# Monitor for 24 hours (every 2 hours generate summary)
ELAPSED=0
while [ "$ELAPSED" -lt 1440 ]; do
  sleep 7200  # 2 hours
  ELAPSED=$((ELAPSED + 120))

  # Get metrics
  IFS=':' read -r p0_errors recoveries <<< "$(check_interval 120)"
  mem_usage=$(docker stats "$CONTAINER_NAME" --no-stream --format "{{.MemPerc}}" 2>/dev/null || echo "N/A")

  log ""
  log "=== Snapshot at ${ELAPSED}min ==="
  log "P0 errors (last 2h): $p0_errors"
  log "Recoveries (last 2h): $recoveries"
  log "Memory usage: $mem_usage"

  # Calculate error/recovery ratio
  if [ "$p0_errors" -gt 0 ]; then
    rate=$((100 * recoveries / (p0_errors + recoveries)))
    log "Recovery rate: ${rate}%"
  fi
done

log ""
log "=== 24-Hour Monitoring Complete ==="
log "Report saved to: $REPORT_FILE"
log "Please review for:"
log "  • Total P0 events detected"
log "  • Success rate of automatic recovery"
log "  • Memory stability"
log "  • Any anomalies requiring attention"
log ""
log "Next: Proceed with Layer 2 permanent fixes if recovery rate > 90%"
