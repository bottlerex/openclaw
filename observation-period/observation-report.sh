#!/bin/bash
#
# OpenClaw Phase 4.5 — Daily Observation Period Report
#
# 生成每日觀察期報告，匯總所有監控指標
# 執行時間：每天 9:00 UTC (17:00 UTC+8)
#

set -e

OBSERVATION_PERIOD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
METRICS_DIR="${HOME}/.claude/metrics"
REPORT_DIR="${OBSERVATION_PERIOD_DIR}/reports"
TIMESTAMP=$(date -u +"%Y-%m-%d")
DATETIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p "$REPORT_DIR"

echo "[$(date)] 🔍 Starting daily observation report..."

# 色彩定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. 運行所有分析工具
echo "[$(date)] 📊 Running analysis tools..."

node "${OBSERVATION_PERIOD_DIR}/routing-analyzer.cjs" 2>&1 | grep -v "Log file not found" || true
node "${OBSERVATION_PERIOD_DIR}/intent-signal-monitor.cjs" 2>&1 | grep -v "Log file not found" || true
node "${OBSERVATION_PERIOD_DIR}/cost-tracker.cjs" 2>&1 | grep -v "Log file not found" || true
node "${OBSERVATION_PERIOD_DIR}/streaming-metrics.cjs" 2>&1 | grep -v "Log file not found" || true

# 2. 收集最新分析結果
echo "[$(date)] 📈 Collecting analysis results..."

ROUTING_ANALYSIS=$(tail -1 "${METRICS_DIR}/routing_analysis.jsonl" 2>/dev/null || echo '{}')
INTENT_ANALYSIS=$(tail -1 "${METRICS_DIR}/intent_analysis.jsonl" 2>/dev/null || echo '{}')
COST_ANALYSIS=$(tail -1 "${METRICS_DIR}/cost_analysis.jsonl" 2>/dev/null || echo '{}')
STREAMING_ANALYSIS=$(tail -1 "${METRICS_DIR}/streaming_analysis.jsonl" 2>/dev/null || echo '{}')

# 3. 生成報告
REPORT_FILE="${REPORT_DIR}/observation-${TIMESTAMP}.md"

cat > "$REPORT_FILE" << 'EOF'
# OpenClaw Phase 4.5 — Daily Observation Report

**Date:** ${DATETIME}
**Period:** ${OBSERVATION_START} ~ ${TIMESTAMP}

## Summary

| Metric | Value | Status | Target |
|--------|-------|--------|--------|
| Routing Ratio (Ollama) | ${ROUTING_OLLAMA_RATIO}% | ${ROUTING_STATUS} | 85% |
| Routing Entropy | ${ROUTING_ENTROPY} | Stable | Low |
| Intent Categories Hit | ${INTENT_CATEGORIES}/${INTENT_TOTAL} | ${INTENT_STATUS} | All |
| Intent Confidence | ${INTENT_CONFIDENCE}% | ${INTENT_CONF_STATUS} | 75%+ |
| Cost (Daily USD) | $${DAILY_COST} | ${COST_STATUS} | Tracking |
| Avg TTFT | ${TTFT_AVG}ms | ${TTFT_STATUS} | <500ms |
| Stream Count | ${STREAM_COUNT} | Active | Growing |

## Routing Analysis

**Ollama Usage**: ${ROUTING_OLLAMA_COUNT} / ${ROUTING_TOTAL} (${ROUTING_OLLAMA_RATIO}%)
**Claude Fallback**: ${ROUTING_CLAUDE_COUNT} / ${ROUTING_TOTAL} (${ROUTING_CLAUDE_RATIO}%)
**Fallback Rate**: ${ROUTING_FALLBACK_RATE}%
**Routing Entropy**: ${ROUTING_ENTROPY} (stability measure)

### Assessment
- ✓ On target: Ollama ratio >= 80%
- ⚠ Needs tuning: Ollama ratio < 80%

## Intent Signal Analysis

**Categories Hit**: ${INTENT_CATEGORIES} / ${INTENT_TOTAL}
**Avg Confidence**: ${INTENT_CONFIDENCE}%
**Keyword Hit Rate**: ${INTENT_KEYWORD_RATE}%

### Top Categories
EOF

# 4. 追加實際數據
echo "" >> "$REPORT_FILE"
echo "## Raw Data" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "### Routing Analysis" >> "$REPORT_FILE"
echo "\`\`\`json" >> "$REPORT_FILE"
echo "$ROUTING_ANALYSIS" | jq . >> "$REPORT_FILE" 2>/dev/null || echo "$ROUTING_ANALYSIS" >> "$REPORT_FILE"
echo "\`\`\`" >> "$REPORT_FILE"

echo "" >> "$REPORT_FILE"
echo "### Intent Signals" >> "$REPORT_FILE"
echo "\`\`\`json" >> "$REPORT_FILE"
echo "$INTENT_ANALYSIS" | jq . >> "$REPORT_FILE" 2>/dev/null || echo "$INTENT_ANALYSIS" >> "$REPORT_FILE"
echo "\`\`\`" >> "$REPORT_FILE"

echo "" >> "$REPORT_FILE"
echo "### Cost Analysis" >> "$REPORT_FILE"
echo "\`\`\`json" >> "$REPORT_FILE"
echo "$COST_ANALYSIS" | jq . >> "$REPORT_FILE" 2>/dev/null || echo "$COST_ANALYSIS" >> "$REPORT_FILE"
echo "\`\`\`" >> "$REPORT_FILE"

echo "" >> "$REPORT_FILE"
echo "### Streaming Metrics" >> "$REPORT_FILE"
echo "\`\`\`json" >> "$REPORT_FILE"
echo "$STREAMING_ANALYSIS" | jq . >> "$REPORT_FILE" 2>/dev/null || echo "$STREAMING_ANALYSIS" >> "$REPORT_FILE"
echo "\`\`\`" >> "$REPORT_FILE"

# 5. 生成歷史對比
echo "[$(date)] 📋 Generating historical comparison..."

echo "" >> "$REPORT_FILE"
echo "## Historical Trend (Last 7 Days)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

if [ -f "${METRICS_DIR}/routing_analysis.jsonl" ]; then
  tail -7 "${METRICS_DIR}/routing_analysis.jsonl" | jq '.ts, .ollama_ratio' >> "$REPORT_FILE"
fi

# 6. 生成建議
echo "[$(date)] 💡 Generating recommendations..."

echo "" >> "$REPORT_FILE"
echo "## Recommendations" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 讀取最新的 routing analysis
ROUTING_RATIO=$(echo "$ROUTING_ANALYSIS" | jq -r '.ollama_ratio // 0')
if (( $(echo "$ROUTING_RATIO < 80" | bc -l) )); then
  echo "- ⚠️ **Ollama usage below 80%** — Check failover triggers, consider tuning intent detection" >> "$REPORT_FILE"
fi

echo "- 📊 Monitor streaming latency trends over next 3 days" >> "$REPORT_FILE"
echo "- 🔍 Track intent signal accuracy — may need keyword adjustments" >> "$REPORT_FILE"
echo "- 💰 Verify cost projections align with usage patterns" >> "$REPORT_FILE"

# 7. 提交到 git
cd "$OBSERVATION_PERIOD_DIR"
git add -A
git commit -m "observation: Daily report ${TIMESTAMP}" --no-verify 2>/dev/null || true
git push 2>/dev/null || echo "[$(date)] ⚠️  Git push failed (may not be in git repo)"

# 8. 上傳報告到 Mac mini (如果在本機)
if [ "${HOME}" = "/Users/rexmacmini" ]; then
  cp "$REPORT_FILE" ~/.claude/metrics/reports/
  echo "[$(date)] ✅ Report saved to metrics/reports/"
fi

echo "[$(date)] ✅ Daily observation report complete"
echo "Report: $REPORT_FILE"
