#!/bin/bash
# Guardian 健康指標收集器
# 每小時輸出健康檢查統計

GUARDIAN_LOG="${GUARDIAN_LOG:-/tmp/openclaw-guardian.log}"
METRICS_LOG="${METRICS_LOG:-.logs/guardian-metrics.jsonl}"
mkdir -p "$(dirname "$METRICS_LOG")"

extract_metrics() {
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
    
    # 從 Guardian 日誌提取指標
    local check_count=$([ -f "$GUARDIAN_LOG" ] && grep -c "修復嘗試\|doctor --fix" "$GUARDIAN_LOG" 2>/dev/null || echo "0")
    local repair_success=$([ -f "$GUARDIAN_LOG" ] && grep -c "修復成功" "$GUARDIAN_LOG" 2>/dev/null || echo "0")
    local repair_failures=$([ -f "$GUARDIAN_LOG" ] && grep -c "修復失敗\|異常" "$GUARDIAN_LOG" 2>/dev/null || echo "0")
    local rollbacks=$([ -f "$GUARDIAN_LOG" ] && grep -c "rollback" "$GUARDIAN_LOG" 2>/dev/null || echo "0")
    
    cat >> "$METRICS_LOG" << EOF
{"timestamp":"$timestamp","health_checks":$check_count,"successful_repairs":$repair_success,"failures":$repair_failures,"rollbacks":$rollbacks}
EOF

    echo "[$timestamp] Guardian 指標: 檢查=$check_count, 修復成功=$repair_success, 失敗=$repair_failures, 回滾=$rollbacks"
}

# 輸出每小時指標
extract_metrics
