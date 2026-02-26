# OpenClaw Phase 4.5 — Observation Period Monitoring

監控 OpenClaw Phase 4.5 「觀察期」(2026-02-26 ~ 2026-03-02，3-5 天) 的完整工具套件。

## 目標指標

| 指標 | 目標 | 監控工具 |
|------|------|---------|
| **Cost Ratio** | Ollama 85% / Claude 15% | `routing-analyzer.cjs` |
| **Intent Accuracy** | Keyword hit rate > 80% | `intent-signal-monitor.cjs` |
| **Failover/Recovery** | Latency < 500ms | `streaming-metrics.cjs` |
| **Stream Latency** | TTFT p95 < 500ms | `streaming-metrics.cjs` |
| **Executor Stability** | Entropy < 0.5 | `routing-analyzer.cjs` |

## 監控工具

### 1. routing-analyzer.cjs
分析路由決策日誌，計算 Ollama vs Claude 的使用比例。

```bash
node routing-analyzer.cjs
```

**輸出**：`~/.claude/metrics/routing_analysis.jsonl`

**指標**：
- `ollama_ratio` — Ollama 使用率 (%)
- `routing_entropy` — 路由熵（0 = 完全穩定，1 = 完全隨機）
- `fallback_rate` — Claude fallback 觸發率
- `avg_latency_ms` — 平均路由延遲

### 2. intent-signal-monitor.cjs
監控意圖檢測層的表現，追蹤 12 個意圖類別的命中率。

```bash
node intent-signal-monitor.cjs
```

**輸出**：`~/.claude/metrics/intent_analysis.jsonl`

**指標**：
- `categories_hit` — 命中的意圖類別數
- `avg_confidence` — 平均信心度
- `keyword_extraction_rate` — Keyword 提取命中率

### 3. cost-tracker.cjs
全路徑成本追蹤，計算 Claude 的實時成本（Ollama 成本為 0）。

```bash
node cost-tracker.cjs
```

**輸出**：`~/.claude/metrics/cost_analysis.jsonl`

**指標**：
- `ollama_ratio` — Ollama 使用比例（%)
- `total_cost_usd` — 累計成本（美元）
- `avg_cost_per_request` — 平均每個請求的成本
- `status` — 是否達到目標

### 4. streaming-metrics.cjs
監控流媒體延遲，計算 TTFT、TPS、Warm-keep 效果。

```bash
node streaming-metrics.cjs
```

**輸出**：`~/.claude/metrics/streaming_analysis.jsonl`

**指標**：
- `avg_ttft_ms` — 平均首 token 延遲
- `p95_ttft_ms` — P95 首 token 延遲
- `avg_tps` — 平均生成速度 (tokens/sec)
- `warm_keep_ttft_improvement` — Warm-keep 效果 (%)

### 5. observation-report.sh
生成每日觀察期報告，匯總所有指標。

```bash
./observation-report.sh
```

**輸出**：`reports/observation-YYYY-MM-DD.md`

## 使用流程

### 手動執行（即時分析）
```bash
cd ~/openclaw/observation-period

# 執行單個分析
node routing-analyzer.cjs
node intent-signal-monitor.cjs
node cost-tracker.cjs
node streaming-metrics.cjs

# 生成完整報告
./observation-report.sh
```

### 自動化（Cron）
```bash
# 每天 09:00 UTC 自動生成報告
0 9 * * * ~/openclaw/observation-period/observation-report.sh >> /tmp/observation-report.log 2>&1

# 每 6 小時執行一次分析
0 */6 * * * cd ~/openclaw/observation-period && \
  node routing-analyzer.cjs && \
  node intent-signal-monitor.cjs && \
  node cost-tracker.cjs && \
  node streaming-metrics.cjs
```

## 監控檢查點

### Day 1 (2026-02-27)
- ✓ Ollama failover 機制驗證
- ✓ TTFT 基線測試
- ✓ 路由決策開始記錄

### Day 2 (2026-02-28)
- ✓ Intent 命中率統計
- ✓ Cost ratio 中途檢查
- ✓ Executor 熵穩定性

### Day 3 (2026-03-01)
- ✓ 成本比例收斂驗證
- ✓ Stream 延遲穩定性
- ✓ Failover/recovery 完整週期

### Day 5 結論 (2026-03-02)
- ✓ 最終成本與性能報告
- ✓ 路由策略評估
- ✓ 下一階段建議

## 凍結政策（觀察期內不可改動）

| 項目 | 政策 |
|------|------|
| 代碼 | 只修 bug，不改路由邏輯 |
| 配置 | 不調 threshold/weights，除非發現異常 |
| Intent | 可加 keyword，不改 category |
| Handler | 只修 bug，不改 execution contract |

違反凍結政策 = 觀察期無效，需重新開始。

## 輸出文件位置

```
~/.claude/metrics/
├── routing_analysis.jsonl         # 每次執行新增一行
├── intent_analysis.jsonl          # 每次執行新增一行
├── cost_analysis.jsonl            # 每次執行新增一行
├── streaming_analysis.jsonl       # 每次執行新增一行
└── reports/
    ├── observation-2026-02-26.md
    ├── observation-2026-02-27.md
    └── ...
```

## 故障排除

### "Log file not found"
- 原因：OpenClaw 尚未生成該日誌文件
- 解決：等待容器運行並生成日誌

### 分析結果全為 0
- 原因：日誌文件為空或格式不匹配
- 檢查：`tail -20 /tmp/openclaw/openclaw.log`

### 無法寫入 metrics 檔案
- 原因：權限不足或目錄不存在
- 解決：`mkdir -p ~/.claude/metrics && chmod 755 ~/.claude/metrics`

## 相關文件

- **Phase 4.5 計劃**：`/tmp/phase-4.5-observation.md`
- **OpenClaw 日誌**：`/tmp/openclaw/openclaw-*.log`
- **Docker 日誌**：`docker logs openclaw-agent`

## 聯繫

如有問題或需要調整監控指標，請更新此目錄中的腳本。

---

**Last Updated**: 2026-02-26
**Frozen Until**: 2026-03-02
