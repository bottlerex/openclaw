#!/bin/bash
# OpenClaw Daily Maintenance Report
# Generates comprehensive daily status report

CONTAINER_NAME="openclaw-agent"
REPORT_DIR="/tmp/openclaw-reports"
REPORT_FILE="$REPORT_DIR/report-$(date +%Y-%m-%d).txt"

mkdir -p "$REPORT_DIR"

generate_report() {
  cat > "$REPORT_FILE" << 'EOF'
╔════════════════════════════════════════════════════════════╗
║    OpenClaw Daily Maintenance Report                       ║
╚════════════════════════════════════════════════════════════╝

Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
System: $(uname -s)

─────────────────────────────────────────────────────────────
SYSTEM STATUS
─────────────────────────────────────────────────────────────

Container Status:
  Name:     openclaw-agent
  Status:   $(docker ps --filter "name=openclaw-agent" --format "{{.State}}")
  Health:   $(docker inspect openclaw-agent --format='{{.State.Health.Status}}' 2>/dev/null || echo "N/A")
  Uptime:   $(docker ps --filter "name=openclaw-agent" --format "{{.Status}}" | grep -oE "Up [^,]*")

Resource Usage:
$(docker stats openclaw-agent --no-stream --format "  CPU: {{.CPUPerc}} | Memory: {{.MemPerc}} | Network: {{.NetIO}}" 2>/dev/null || echo "  N/A")

─────────────────────────────────────────────────────────────
LAST 24H METRICS
─────────────────────────────────────────────────────────────

P0 Events:
  P0.1 (stuck):     $(docker logs openclaw-agent --since 24h 2>/dev/null | grep -c "health-monitor.*stuck" || true) times
  P0.2 (409):       $(docker logs openclaw-agent --since 24h 2>/dev/null | grep -c "409: Conflict" || true) times
  P0.3 (1006):      $(docker logs openclaw-agent --since 24h 2>/dev/null | grep -c "code=1006" || true) times
  P0.4 (exec):      $(docker logs openclaw-agent --since 24h 2>/dev/null | grep -c "exec failed" || true) times

Recoveries:
  Auto-restarts:    $(docker logs openclaw-agent --since 24h 2>/dev/null | grep -c "starting provider" || true) times

Errors:
  Total errors:     $(docker logs openclaw-agent --since 24h 2>/dev/null | grep -ic "error" || true) occurrences
  Timeouts:         $(docker logs openclaw-agent --since 24h 2>/dev/null | grep -ic "timeout" || true) occurrences

─────────────────────────────────────────────────────────────
MONITORING STATUS
─────────────────────────────────────────────────────────────

Background Processes:
  P0 Monitor Dispatcher: $(ps aux | grep -c "p0-monitor-dispatcher" || true) active
  RAG Performance Mon:   $(ps aux | grep -c "rag-performance-monitor" || true) active
  Guardian Metrics:      $(ps aux | grep -c "guardian-metrics-collector" || true) active

Log Files:
  P0 Monitor:    $(wc -l < /tmp/p0-monitor-dispatcher.log 2>/dev/null || echo "N/A") lines
  RAG Perf:      $(wc -l < /tmp/rag-performance.log 2>/dev/null || echo "N/A") lines
  Guardian:      $(wc -l < /tmp/guardian-metrics.log 2>/dev/null || echo "N/A") lines

─────────────────────────────────────────────────────────────
RECENT ERRORS (Last 10)
─────────────────────────────────────────────────────────────

$(docker logs openclaw-agent --since 24h 2>/dev/null | grep -iE "error|failed|timeout" | tail -10 || echo "None detected")

─────────────────────────────────────────────────────────────
RECOMMENDATIONS
─────────────────────────────────────────────────────────────

EOF

  # Add recommendations based on metrics
  local error_count=$(docker logs openclaw-agent --since 24h 2>/dev/null | grep -ic "error" || true)
  local p0_count=$(docker logs openclaw-agent --since 24h 2>/dev/null | grep -Ec "stuck|409|1006|exec.*failed" || true)

  if [ "$p0_count" -eq 0 ]; then
    echo "✅ System running smoothly, no P0 events detected" >> "$REPORT_FILE"
  elif [ "$p0_count" -lt 3 ]; then
    echo "⚠️  Minor issues detected ($p0_count events), monitor closely" >> "$REPORT_FILE"
  else
    echo "🔴 Multiple P0 events detected ($p0_count), investigation recommended" >> "$REPORT_FILE"
  fi

  if [ "$error_count" -gt 10 ]; then
    echo "🔴 High error count ($error_count), review logs for patterns" >> "$REPORT_FILE"
  fi

  echo "" >> "$REPORT_FILE"
  # macOS compatible date calculation
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Next review: $(date -u -v+1d +%Y-%m-%dT%H:%M:%SZ)" >> "$REPORT_FILE"
  else
    echo "Next review: $(date -u +%Y-%m-%dT%H:%M:%SZ -d "+1 day")" >> "$REPORT_FILE"
  fi

  # Display report
  cat "$REPORT_FILE"

  # Save to archive
  gzip -c "$REPORT_FILE" > "$REPORT_DIR/report-$(date +%Y-%m-%d).txt.gz"
}

generate_report
