# OpenClaw Agent - RAG 監控集成指南

## 概述

本文檔說明如何在 OpenClaw Agent 中集成 RAG 性能監控。

## 快速開始

### 1. 初始化監控 (Agent 啟動時)

```typescript
import { agentRAG } from './monitoring/agent-rag-adapter';

async function initializeAgent() {
  // 初始化 RAG 監控
  await agentRAG.initialize();
  
  // ... 其他初始化代碼
}
```

### 2. 包裝搜尋操作

```typescript
// 在搜尋工具中
async function executeTool_Search(params) {
  return await agentRAG.executeSearch(
    async (query, topK) => {
      // 這裡是實際的搜尋實現
      return await myVectorDB.search(query, topK);
    },
    'general',          // 查詢類型
    params.query,       // 搜尋查詢
    params.topK || 5    // 返回結果數
  );
}
```

### 3. 更新索引元數據

```typescript
// 當索引更新時
async function refreshRAGIndex() {
  const stats = await myVectorDB.getIndexStats();
  agentRAG.updateIndexMetadata(
    stats.sizeBytes,    // 索引大小 (bytes)
    stats.vectorCount   // 向量數量
  );
}
```

## 指標訪問

### Prometheus Metrics

```bash
curl http://127.0.0.1:9091/metrics
```

查詢特定指標：
```bash
curl 'http://127.0.0.1:9091/metrics?name=rag_search_duration_ms'
```

### 健康檢查

```bash
curl http://127.0.0.1:9091/health
```

## 支援的查詢類型

- `general` - 一般查詢
- `technical` - 技術文檔查詢
- `financial` - 金融相關查詢
- `semantic` - 語義搜尋
- `hybrid` - 混合搜尋

## 預期性能

| 操作 | P50 | P95 | P99 |
|------|-----|-----|-----|
| 搜尋延遲 | 100ms | 500ms | 1000ms |
| 向量化 | 50ms | 200ms | 300ms |
| 向量搜尋 | 20ms | 100ms | 200ms |

## 告警規則

系統會自動觸發以下告警：

- **RAG P95 延遲 > 1000ms** (warning)
- **RAG P95 延遲 > 2000ms** (critical)
- **失敗率 > 5%** (warning)
- **失敗率 > 20%** (critical)
- **索引大小增長 > 100MB/day** (info)

## 故障排查

### Metrics 端點無法訪問

```bash
# 檢查 exporter 進程
ps aux | grep start-rag-metrics

# 檢查日誌
tail -50 logs/prometheus-exporter.log

# 重啟 exporter
node scripts/start-rag-metrics.mjs &
```

### Prometheus 無法抓取

確認配置中包含：
```yaml
- job_name: 'openclaw-rag-metrics'
  static_configs:
    - targets: ['host.docker.internal:9091']
```

### Grafana 無法顯示數據

1. 驗證 Prometheus 數據源配置
2. 確認 Prometheus 有 RAG metrics
3. 重新導入儀表板

## 文件結構

```
src/monitoring/
├── rag-monitor.ts              # 核心監控類
├── prometheus-exporter.ts       # Prometheus 端點
├── agent-rag-adapter.ts         # Agent 集成適配層
└── AGENT_INTEGRATION.md         # 本文檔
```

## 相關文件

- 實施指南: `docs/P1_1_IMPLEMENTATION_GUIDE.md`
- 集成清單: `docs/P1_1_INTEGRATION_CHECKLIST.md`
- Grafana 儀表板: `config/grafana-rag-dashboard.json`
- 告警規則: `config/rag-alerting-rules.yaml`
