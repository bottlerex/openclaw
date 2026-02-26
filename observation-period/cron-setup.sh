#!/bin/bash
#
# Setup cron jobs for OpenClaw Phase 4.5 observation period
#
# Usage: bash cron-setup.sh [install|remove]
#

set -e

OBSERVATION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRON_USER="${USER}"

function install_crons() {
  echo "📋 Installing cron jobs for observation period..."

  # 建立臨時 crontab 文件
  TEMP_CRON=$(mktemp)

  # 匯出現有的 cron 設定
  crontab -l 2>/dev/null > "$TEMP_CRON" || true

  # 添加新的 cron 工作（檢查是否已存在）
  if ! grep -q "observation-period" "$TEMP_CRON"; then
    echo "" >> "$TEMP_CRON"
    echo "# OpenClaw Phase 4.5 — Observation Period" >> "$TEMP_CRON"
    echo "# Run analysis every 6 hours" >> "$TEMP_CRON"
    echo "0 */6 * * * cd ${OBSERVATION_DIR} && node routing-analyzer.cjs >> /tmp/observation-routing.log 2>&1" >> "$TEMP_CRON"
    echo "0 */6 * * * cd ${OBSERVATION_DIR} && node intent-signal-monitor.cjs >> /tmp/observation-intent.log 2>&1" >> "$TEMP_CRON"
    echo "0 */6 * * * cd ${OBSERVATION_DIR} && node cost-tracker.cjs >> /tmp/observation-cost.log 2>&1" >> "$TEMP_CRON"
    echo "0 */6 * * * cd ${OBSERVATION_DIR} && node streaming-metrics.cjs >> /tmp/observation-stream.log 2>&1" >> "$TEMP_CRON"
    echo "" >> "$TEMP_CRON"
    echo "# Daily report at 09:00 UTC (17:00 UTC+8)" >> "$TEMP_CRON"
    echo "0 9 * * * ${OBSERVATION_DIR}/observation-report.sh >> /tmp/observation-report.log 2>&1" >> "$TEMP_CRON"

    # 安裝新的 crontab
    crontab "$TEMP_CRON"
    echo "✅ Cron jobs installed:"
    echo "   - Routing analysis: every 6 hours"
    echo "   - Intent signals: every 6 hours"
    echo "   - Cost tracking: every 6 hours"
    echo "   - Streaming metrics: every 6 hours"
    echo "   - Daily report: 09:00 UTC"
  else
    echo "⚠️  Observation period crons already installed"
  fi

  rm -f "$TEMP_CRON"
}

function remove_crons() {
  echo "🗑️  Removing cron jobs..."

  TEMP_CRON=$(mktemp)
  crontab -l 2>/dev/null > "$TEMP_CRON" || true

  # 移除 observation period 相關的行
  grep -v "observation-period" "$TEMP_CRON" | grep -v "observation-routing" | grep -v "observation-intent" | \
  grep -v "observation-cost" | grep -v "observation-stream" | grep -v "observation-report" > "$TEMP_CRON.new" || true

  # 檢查是否有改動
  if ! diff -q "$TEMP_CRON" "$TEMP_CRON.new" >/dev/null 2>&1; then
    crontab "$TEMP_CRON.new"
    echo "✅ Cron jobs removed"
  else
    echo "⚠️  No observation period crons found"
  fi

  rm -f "$TEMP_CRON" "$TEMP_CRON.new"
}

# 主邏輯
case "${1:-install}" in
  install)
    install_crons
    ;;
  remove)
    remove_crons
    ;;
  *)
    echo "Usage: $0 [install|remove]"
    exit 1
    ;;
esac
