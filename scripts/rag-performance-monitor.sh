#!/bin/bash
# OpenClaw RAG Performance Monitoring
# Tracks knowledge retrieval performance over time

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/rag-performance.log"

log() {
  local timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

# Extract RAG metrics from container logs
extract_rag_metrics() {
  docker logs "$CONTAINER_NAME" --since 1h 2>/dev/null | \
    grep -i "rag\|search\|vector" | \
    grep -oE "[0-9]+ms" | \
    awk -F'ms' '{sum+=$1; count++} END {if (count > 0) printf "avg=%dms, count=%d\n", sum/count, count; else print "no_data"}'
}

# Monitor RAG index size
check_rag_index() {
  docker exec "$CONTAINER_NAME" du -sh /home/node/.openclaw/knowledge.db 2>/dev/null || echo "unknown"
}

# Generate report
generate_rag_report() {
  log "=== RAG Performance Report ==="

  local metrics=$(extract_rag_metrics)
  local db_size=$(check_rag_index)

  log "Search latency (1h): $metrics"
  log "Knowledge DB size: $db_size"

  # Performance thresholds
  local avg_latency=$(echo "$metrics" | grep -oE "avg=[0-9]+" | cut -d= -f2)
  if [ -n "$avg_latency" ]; then
    if [ "$avg_latency" -gt 500 ]; then
      log "⚠️  RAG search latency high (>500ms) - consider index optimization"
    else
      log "✅ RAG search latency normal"
    fi
  fi
}

log "Starting RAG performance monitoring..."
log "Container: $CONTAINER_NAME"
log "Report interval: 1 hour"

# Run continuously, report every hour
while true; do
  sleep 3600
  generate_rag_report
done
