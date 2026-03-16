#!/bin/bash
# OpenClaw 每日健康檢查記錄

# 從容器內部取 health（避免 HTTPS 問題）
HEALTH_URL="docker exec openclaw-agent curl -s http://localhost:18789/health"
LOG_DIR="$HOME/openclaw/logs"
METRICS_DIR="$HOME/openclaw/metrics"

mkdir -p "$LOG_DIR" "$METRICS_DIR"

# 獲取健康檢查數據
HEALTH_DATA=$($HEALTH_URL 2>/dev/null)

if [ -z "$HEALTH_DATA" ]; then
    echo "❌ Health check failed at $(date)" >> "$LOG_DIR/daily-health.log"
    exit 1
fi

# 提取關鍵指標
STATUS=$(echo "$HEALTH_DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null)
UPTIME=$(echo "$HEALTH_DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('uptime_seconds',0))" 2>/dev/null)
MODEL=$(echo "$HEALTH_DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('model','unknown'))" 2>/dev/null)
REQUESTS=$(echo "$HEALTH_DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('requests_total',0))" 2>/dev/null)

# 記錄到 JSONL 格式
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "{\"ts\":\"$TIMESTAMP\",\"status\":\"$STATUS\",\"uptime_seconds\":$UPTIME,\"model\":\"$MODEL\",\"requests_total\":$REQUESTS}" >> "$METRICS_DIR/health-check-daily.jsonl"

# 簡要日誌
echo "✓ $TIMESTAMP | Status: $STATUS | Model: $MODEL | Uptime: $(($UPTIME/3600))h $(($UPTIME%3600/60))m" >> "$LOG_DIR/daily-health.log"

# 記錄到 Work Tracker
~/.claude/scripts/wt-log.sh "OpenClaw" "meta" "每日穩定性監控: status=$STATUS, model=$MODEL, uptime=${UPTIME}s" 2 "auto" null null null 1000 2>/dev/null || true

