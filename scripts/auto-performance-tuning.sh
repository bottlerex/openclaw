#!/bin/bash
# OpenClaw Auto Performance Tuning
# Monitors performance and automatically adjusts configuration

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/auto-performance-tuning.log"
TUNING_THRESHOLD_MEMORY=80  # Restart if memory > 80%
TUNING_THRESHOLD_ERROR=10   # Alert if errors > 10/hour

log() {
  local timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

# Check memory and optimize
auto_optimize_memory() {
  log "=== Memory Optimization Check ==="

  local mem_percent=$(docker stats "$CONTAINER_NAME" --no-stream --format "{{.MemPerc}}" 2>/dev/null | sed 's/%//')

  if (( $(echo "$mem_percent > $TUNING_THRESHOLD_MEMORY" | bc -l 2>/dev/null || echo 0) )); then
    log "⚠️  Memory high ($mem_percent%), attempting optimization..."

    # Strategy 1: Trigger garbage collection (if supported)
    # docker exec "$CONTAINER_NAME" kill -USR2 <pid> 2>/dev/null || true

    # Strategy 2: Restart container if memory leak detected
    local prev_mem=$(cat /tmp/prev_memory.txt 2>/dev/null || echo "0")
    if (( $(echo "$mem_percent > 85" | bc -l 2>/dev/null || echo 0) )); then
      log "🔴 Critical memory usage, restarting container..."
      docker restart "$CONTAINER_NAME"
      sleep 10
      log "✅ Container restarted"
    fi

    echo "$mem_percent" > /tmp/prev_memory.txt
  else
    log "✅ Memory usage normal: ${mem_percent}%"
  fi
}

# Detect performance degradation
detect_degradation() {
  log ""
  log "=== Performance Degradation Detection ==="

  # Check RAG search latency
  local rag_latency=$(docker logs "$CONTAINER_NAME" --since 1h 2>/dev/null | \
    grep -oE "[0-9]+ms" | tail -10 | awk -F'ms' '{sum+=$1} END {print sum/NR}')

  if [ -n "$rag_latency" ]; then
    if (( $(echo "$rag_latency > 500" | bc -l 2>/dev/null || echo 0) )); then
      log "⚠️  RAG search slow (${rag_latency}ms > 500ms)"
      log "Action: Consider RAG index optimization"
    else
      log "✅ RAG latency normal: ${rag_latency}ms"
    fi
  fi

  # Check error rate
  local error_count=$(docker logs "$CONTAINER_NAME" --since 1h 2>/dev/null | grep -ic "error" || true)
  if [ "$error_count" -gt "$TUNING_THRESHOLD_ERROR" ]; then
    log "⚠️  High error rate: $error_count errors/hour"
    log "Action: Review logs at docker logs $CONTAINER_NAME"
  else
    log "✅ Error rate normal: $error_count/hour"
  fi
}

# Optimize configuration
auto_tune_config() {
  log ""
  log "=== Configuration Auto-Tuning ==="

  # Check if environment variables are optimal
  local health_interval=$(docker exec "$CONTAINER_NAME" env | grep "OPENCLAW_HEALTH_CHECK_INTERVAL" | cut -d= -f2)

  if [ -z "$health_interval" ]; then
    log "⚠️  OPENCLAW_HEALTH_CHECK_INTERVAL not set, health checks may be slow"
  else
    log "✅ Health check interval: $health_interval"
  fi

  local ws_heartbeat=$(docker exec "$CONTAINER_NAME" env | grep "OPENCLAW_WEBSOCKET_HEARTBEAT" | cut -d= -f2)
  if [ -z "$ws_heartbeat" ]; then
    log "⚠️  WebSocket heartbeat not configured, 1006 disconnects possible"
  else
    log "✅ WebSocket heartbeat: $ws_heartbeat"
  fi
}

# Generate recommendations
generate_recommendations() {
  log ""
  log "=== Tuning Recommendations ==="

  local mem_percent=$(docker stats "$CONTAINER_NAME" --no-stream --format "{{.MemPerc}}" 2>/dev/null | sed 's/%//')
  local cpu_percent=$(docker stats "$CONTAINER_NAME" --no-stream --format "{{.CPUPerc}}" 2>/dev/null | sed 's/%//')

  if (( $(echo "$mem_percent > 70" | bc -l 2>/dev/null || echo 0) )); then
    log "💡 Recommendation 1: Increase container memory limit (current: 2G)"
    log "   → Edit docker-compose.yml, increase 'memory: 2G' to 4G"
  fi

  if (( $(echo "$cpu_percent > 50" | bc -l 2>/dev/null || echo 0) )); then
    log "💡 Recommendation 2: Consider multi-instance setup for load distribution"
  fi

  # Check if RAG index is too large
  local db_size=$(docker exec "$CONTAINER_NAME" du -sh /home/node/.openclaw/knowledge.db 2>/dev/null | awk '{print $1}')
  if [ -n "$db_size" ]; then
    log "💡 RAG Index Size: $db_size"
    log "   If > 500MB, consider archiving old entries or rebuilding index"
  fi
}

# Main execution
log "Starting auto performance tuning..."
log "Container: $CONTAINER_NAME"

auto_optimize_memory
detect_degradation
auto_tune_config
generate_recommendations

log ""
log "Performance tuning cycle completed"
