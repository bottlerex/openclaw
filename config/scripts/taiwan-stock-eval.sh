#!/usr/bin/env bash
# OpenClaw host script: taiwan-stock-eval.sh
# Purpose: Run taiwan-stock paper trading evaluation queries
# Usage: taiwan-stock-eval.sh [--since YYYY-MM-DD] [--json]
set -euo pipefail

CONTAINER="taiwan-stock-postgres"
DB="taiwan_stock"
SINCE="2026-03-15"
JSON_MODE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) SINCE="$2"; shift 2 ;;
    --json) JSON_MODE=1; shift ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

run_sql() {
  docker exec "$CONTAINER" psql -U postgres -d "$DB" -t -A -F'|' -c "$1" 2>/dev/null
}

# 1. Per-strategy performance
STRATEGY_PERF=$(run_sql "
SELECT template_name,
  COUNT(*) as trades,
  ROUND(AVG(pnl_pct)::numeric, 2) as avg_pnl,
  ROUND(SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as wr,
  ROUND(SUM(pnl)::numeric, 0) as total_pnl
FROM paper_trades
WHERE entry_date >= '$SINCE'
GROUP BY template_name
ORDER BY total_pnl DESC NULLS LAST;
")

# 2. Overall summary
OVERALL=$(run_sql "
SELECT
  COUNT(*) as total_trades,
  SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) as closed,
  SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open,
  ROUND(AVG(CASE WHEN status='closed' THEN pnl_pct END)::numeric, 2) as avg_pnl,
  ROUND(SUM(CASE WHEN pnl_pct > 0 AND status='closed' THEN 1 ELSE 0 END)::numeric
    / NULLIF(SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END), 0) * 100, 1) as wr,
  ROUND(SUM(CASE WHEN status='closed' THEN pnl ELSE 0 END)::numeric, 0) as total_pnl
FROM paper_trades
WHERE entry_date >= '$SINCE';
")

# 3. Slippage check (entry_price vs NEXT trading day open)
# entry_price = signal day close, actual execution = next day open
SLIPPAGE=$(run_sql "
SELECT
  COUNT(*) as checked,
  ROUND(AVG(ABS((next_day.open_price - pt.entry_price) / pt.entry_price * 100))::numeric, 2) as avg_gap_pct,
  ROUND(MAX(ABS((next_day.open_price - pt.entry_price) / pt.entry_price * 100))::numeric, 2) as max_gap_pct
FROM paper_trades pt
JOIN LATERAL (
  SELECT open_price FROM daily_prices
  WHERE stock_id = pt.stock_id AND trade_date > pt.entry_date
  ORDER BY trade_date ASC LIMIT 1
) next_day ON true
WHERE pt.entry_date >= '$SINCE' AND pt.status NOT IN ('data_error');
")

# 4. Kill switch candidates (WR < 30% or avg_pnl < 0 with >= 5 trades)
KILL_CANDIDATES=$(run_sql "
SELECT template_name, COUNT(*) as trades,
  ROUND(AVG(pnl_pct)::numeric, 2) as avg_pnl,
  ROUND(SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as wr
FROM paper_trades
WHERE entry_date >= '$SINCE' AND status='closed'
GROUP BY template_name
HAVING COUNT(*) >= 5
  AND (SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END)::float / COUNT(*) < 0.30
    OR AVG(pnl_pct) < 0)
ORDER BY AVG(pnl_pct);
")

# 5. Open positions health (max drawdown from entry)
OPEN_HEALTH=$(run_sql "
SELECT template_name,
  COUNT(*) as positions,
  ROUND(AVG(CASE WHEN lowest_price > 0 AND entry_price > 0
    THEN (lowest_price - entry_price) / entry_price * 100 END)::numeric, 2) as avg_max_drawdown,
  ROUND(MIN(CASE WHEN lowest_price > 0 AND entry_price > 0
    THEN (lowest_price - entry_price) / entry_price * 100 END)::numeric, 2) as worst_drawdown
FROM paper_trades
WHERE status='open' AND entry_date >= '$SINCE'
GROUP BY template_name
ORDER BY worst_drawdown;
")

# 6. Recent trades (last 3 days)
RECENT=$(run_sql "
SELECT entry_date, COUNT(*),
  string_agg(DISTINCT template_name, ', ') as strategies
FROM paper_trades
WHERE entry_date >= CURRENT_DATE - 3
GROUP BY entry_date ORDER BY entry_date DESC;
")

NOW=$(date '+%Y-%m-%d %H:%M')

if [[ $JSON_MODE -eq 1 ]]; then
  # JSON output for programmatic use
  cat <<EOJSON
{
  "timestamp": "$NOW",
  "since": "$SINCE",
  "overall": "$OVERALL",
  "strategy_performance": $(echo "$STRATEGY_PERF" | python3 -c "
import sys, json
lines = [l.strip() for l in sys.stdin if l.strip()]
result = []
for l in lines:
    parts = l.split('|')
    if len(parts) >= 5:
        result.append({'template': parts[0], 'trades': int(parts[1]), 'avg_pnl': float(parts[2]), 'wr': float(parts[3]), 'total_pnl': float(parts[4])})
print(json.dumps(result))
" 2>/dev/null || echo "[]"),
  "slippage": "$SLIPPAGE",
  "kill_candidates": "$KILL_CANDIDATES"
}
EOJSON
else
  # Human-readable output for Telegram
  cat <<EOTEXT
Taiwan Stock 評估報告 ($NOW)
期間: $SINCE 至今
━━━━━━━━━━━━━━━━━━━━━━

整體績效:
$( if [[ -z "$OVERALL" ]]; then echo "  尚無已結算交易"; else
  IFS='|' read -r total closed open avg_pnl wr total_pnl <<< "$OVERALL"
  echo "  總交易: $total (已結: $closed / 持倉: $open)"
  echo "  勝率: ${wr:-N/A}% | 平均報酬: ${avg_pnl:-N/A}%"
  echo "  總損益: NT\$${total_pnl:-0}"
fi )

策略績效:
$( if [[ -z "$STRATEGY_PERF" ]]; then echo "  尚無數據"; else
  while IFS='|' read -r tmpl trades avg wr pnl; do
    echo "  $tmpl: ${trades}筆 WR:${wr}% Avg:${avg}% PnL:NT\$${pnl}"
  done <<< "$STRATEGY_PERF"
fi )

Slippage:
$( if [[ -z "$SLIPPAGE" ]]; then echo "  尚無數據"; else
  IFS='|' read -r checked avg_gap max_gap <<< "$SLIPPAGE"
  echo "  樣本: $checked | 平均: ${avg_gap:-N/A}% | 最大: ${max_gap:-N/A}%"
fi )

持倉健康度 (最大回撤):
$( if [[ -z "$OPEN_HEALTH" ]]; then echo "  無持倉"; else
  while IFS='|' read -r tmpl pos avg_dd worst_dd; do
    echo "  $tmpl: ${pos}筆 平均回撤:${avg_dd:-N/A}% 最差:${worst_dd:-N/A}%"
  done <<< "$OPEN_HEALTH"
fi )

Kill Switch 候選:
$( if [[ -z "$KILL_CANDIDATES" ]]; then echo "  無 (正常)"; else
  while IFS='|' read -r tmpl trades avg wr; do
    echo "  ⚠ $tmpl: ${trades}筆 WR:${wr}% Avg:${avg}%"
  done <<< "$KILL_CANDIDATES"
fi )

近期交易:
$( if [[ -z "$RECENT" ]]; then echo "  近3天無新交易"; else
  while IFS='|' read -r dt cnt strats; do
    echo "  $dt: ${cnt}筆 ($strats)"
  done <<< "$RECENT"
fi )
EOTEXT
fi
