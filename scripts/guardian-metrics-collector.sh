#!/bin/bash
# OpenClaw Guardian Metrics Collector
# Collects system health and performance metrics

CONTAINER_NAME="openclaw-agent"
METRICS_FILE="/tmp/guardian-metrics.jsonl"

# Log metrics as JSONL (one JSON per line)
log_metric() {
  local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local metric_name=$1
  local value=$2
  local unit=$3

  # Format: {"timestamp":"...", "metric":"...", "value":"...", "unit":"..."}
  echo "{\"timestamp\":\"$timestamp\",\"metric\":\"$metric_name\",\"value\":$value,\"unit\":\"$unit\"}" >> "$METRICS_FILE"
}

# Collect CPU usage
get_cpu_usage() {
  docker stats "$CONTAINER_NAME" --no-stream --format "{{.CPUPerc}}" 2>/dev/null | sed 's/%//'
}

# Collect memory usage
get_memory_usage() {
  docker stats "$CONTAINER_NAME" --no-stream --format "{{.MemUsage}}" 2>/dev/null | awk '{print $1}' | sed 's/MiB//'
}

# Collect memory percentage
get_memory_percent() {
  docker stats "$CONTAINER_NAME" --no-stream --format "{{.MemPerc}}" 2>/dev/null | sed 's/%//'
}

# Count P0 events (last hour)
get_p0_count() {
  docker logs "$CONTAINER_NAME" --since 1h 2>/dev/null | \
    grep -c "health-monitor.*stuck\|409: Conflict\|code=1006\|exec.*denied" || echo "0"
}

# Count recoveries (last hour)
get_recovery_count() {
  docker logs "$CONTAINER_NAME" --since 1h 2>/dev/null | \
    grep -c "starting provider\|restarting\|reconnecting" || echo "0"
}

# Uptime
get_uptime_seconds() {
  docker inspect "$CONTAINER_NAME" --format='{{.State.StartedAt}}' 2>/dev/null | \
    xargs date -f "%Y-%m-%dT%H:%M:%S%z" -d "%s" +%s 2>/dev/null || echo "0"
}

# Collect all metrics
collect_metrics() {
  log_metric "cpu_usage_percent" "$(get_cpu_usage)" "percent"
  log_metric "memory_usage_mib" "$(get_memory_usage)" "MiB"
  log_metric "memory_percent" "$(get_memory_percent)" "percent"
  log_metric "p0_events_1h" "$(get_p0_count)" "count"
  log_metric "recoveries_1h" "$(get_recovery_count)" "count"
}

# Main loop
echo "Starting Guardian metrics collection..."
echo "Metrics file: $METRICS_FILE"

while true; do
  collect_metrics
  sleep 300  # Collect every 5 minutes
done
