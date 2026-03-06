#!/bin/bash
# WebSocket 內存監控 — 檢測 leak，記錄趨勢

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/websocket-memory.log"
INTERVAL=300  # 5 分鐘

log_memory() {
  MEM=$(docker stats --no-stream "$CONTAINER_NAME" --format '{{.MemUsage}}' 2>/dev/null | grep -oE '^[0-9]+' || echo 0)
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Memory: ${MEM}MB" >> "$LOG_FILE"
}

# 輪詢記錄
while true; do
  log_memory
  sleep "$INTERVAL"
done
