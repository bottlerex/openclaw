#!/bin/bash
# Enhanced RAG Performance Monitoring v2
# 記錄搜索延遲、索引大小、同步頻率

LOG_DIR="${LOG_DIR:-.logs}"
PERF_LOG="${LOG_DIR}/rag-performance.jsonl"
mkdir -p "${LOG_DIR}"

CONTAINER_NAME="openclaw-agent"
DB_PATH="./data/rag-index.sqlite"
MONITORING_INTERVAL="${1:-3600}"  # Default 1 hour

log_perf() {
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
    local index_size=$([ -f "$DB_PATH" ] && du -b "$DB_PATH" | cut -f1 || echo "0")
    local index_size_mb=$(echo "scale=2; $index_size / 1024 / 1024" | bc)
    
    # 從日誌中提取最近的搜索延遲（簡化實現）
    local recent_searches=$(docker logs "$CONTAINER_NAME" --since 1h 2>/dev/null | grep -i "search\|rag" | wc -l)
    
    cat >> "$PERF_LOG" << EOF
{"timestamp":"$timestamp","index_size_bytes":$index_size,"index_size_mb":$index_size_mb,"recent_searches":$recent_searches}
EOF
    
    echo "[$timestamp] RAG 性能記錄: 索引=${index_size_mb}MB, 搜索次數=$recent_searches"
}

# 主監控迴圈
echo "[$(date)] RAG 性能監控已啟動 (間隔: ${MONITORING_INTERVAL}s)"

while true; do
    log_perf
    sleep "$MONITORING_INTERVAL"
done
