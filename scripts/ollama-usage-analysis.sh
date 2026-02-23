#!/bin/bash
# OpenClaw Ollama 使用率分析

METRICS_URL="http://localhost:3457/metrics/model-usage"
METRICS_DIR="$HOME/openclaw/metrics"

mkdir -p "$METRICS_DIR"

# 獲取最新 metrics
METRICS=$(curl -s "$METRICS_URL" 2>/dev/null)

if [ -z "$METRICS" ]; then
    echo "❌ Metrics fetch failed at $(date)"
    exit 1
fi

# 計算統計
OLLAMA_CALLS=$(echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['ollama']['calls'])" 2>/dev/null || echo 0)
CLAUDE_CALLS=$(echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['claude']['calls'])" 2>/dev/null || echo 0)
TOTAL_CALLS=$((OLLAMA_CALLS + CLAUDE_CALLS))
OLLAMA_PCT="N/A"

if [ "$TOTAL_CALLS" -gt 0 ]; then
    OLLAMA_PCT=$((100 * OLLAMA_CALLS / TOTAL_CALLS))
fi

# 記錄分析結果
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "{\"ts\":\"$TIMESTAMP\",\"ollama_calls\":$OLLAMA_CALLS,\"claude_calls\":$CLAUDE_CALLS,\"total_calls\":$TOTAL_CALLS,\"ollama_pct\":$OLLAMA_PCT}" >> "$METRICS_DIR/model-usage-analysis.jsonl"

# 簡要統計
echo "✓ $TIMESTAMP | Total: $TOTAL_CALLS | Ollama: $OLLAMA_CALLS ($OLLAMA_PCT%) | Claude: $CLAUDE_CALLS" >> "$METRICS_DIR/usage-summary.log"

