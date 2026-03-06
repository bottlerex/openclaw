# OpenClaw P1.1: RAG Performance Monitoring - Implementation Guide

**Date**: 2026-03-06
**Status**: Ready for Integration
**Estimated Time**: 1.5 hours (20min design + 30min code + 15min Prometheus + 15min alerts + 20min dashboard)

---

## Overview

P1.1 adds comprehensive Prometheus-based performance monitoring to OpenClaw's RAG (Retrieval-Augmented Generation) search operations. This enables:

- 📊 Real-time visibility into search latency (P50/P95/P99)
- 📊 Success/failure rate tracking
- 📊 Index health metrics (size, vector count)
- 📊 Component performance breakdown (embedding, vector search)
- 🚨 Automated alerts for performance degradation

---

## Files Created

| File | Type | Lines | Purpose |
|------|------|-------|---------|
| `src/monitoring/rag-monitor.ts` | TypeScript | 172 | RAG metrics collection and instrumentation |
| `src/monitoring/prometheus-exporter.ts` | TypeScript | 181 | Prometheus /metrics HTTP endpoint |
| `config/rag-alerting-rules.yaml` | YAML | 127 | Alert rules for Prometheus AlertManager |
| `config/grafana-rag-dashboard.json` | JSON | 284 | Grafana dashboard with 7 visualization panels |

**Total new code**: 764 lines

---

## Implementation Steps

### Step 1: Install Prometheus Client Library

```bash
cd /Users/rexmacmini/openclaw
npm install prom-client@15.0.0
# or
yarn add prom-client@15.0.0
```

**Verification**:
```bash
npm list prom-client
# Expected: prom-client@15.0.0
```

---

### Step 2: Integrate RAG Monitor into Agent Execution

Add RAG monitoring to your agent/tool execution flow:

**File**: `src/agents/agent-executor.ts` (or equivalent)

```typescript
import { ragMonitor } from '../monitoring/rag-monitor';

class AgentExecutor {
  async executeToolRAGSearch(query: string, options: any) {
    try {
      // Your existing RAG search logic
      const results = await this.ragService.search(query, options);

      // Instrument with monitoring
      const monitoredResult = await ragMonitor.search({
        queryType: options.type || 'general',
        query: query,
        topK: options.topK || 5
      });

      return monitoredResult;
    } catch (error) {
      // Errors are automatically tracked by MonitoredRAGSearch
      throw error;
    }
  }
}
```

---

### Step 3: Initialize Prometheus Exporter

Add to your main application startup:

**File**: `src/app.ts` or `src/main.ts`

```typescript
import { exporter } from './monitoring/prometheus-exporter';
import { ragMonitor } from './monitoring/rag-monitor';

async function main() {
  // ... existing initialization ...

  // Start Prometheus metrics exporter
  await exporter.start();
  console.log('✅ Prometheus exporter started on http://127.0.0.1:9091/metrics');

  // Initialize RAG monitor (optional: with initial index metadata)
  ragMonitor.setIndexMetadata(0, 0); // Will be updated as documents are indexed

  // ... rest of startup ...
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

---

### Step 4: Configure Prometheus Scrape Job

**File**: `config/prometheus.yml` (or wherever Prometheus is configured)

Add this scrape configuration:

```yaml
global:
  scrape_interval: 30s
  evaluation_interval: 30s

scrape_configs:
  # ... existing jobs ...

  - job_name: 'openclaw-rag-metrics'
    static_configs:
      - targets: ['localhost:9091']
    metrics_path: '/metrics'
    scrape_interval: 30s
    scrape_timeout: 10s
```

**Verification**:
```bash
# Check Prometheus target
curl http://localhost:9090/api/v1/targets

# Check metrics endpoint
curl http://127.0.0.1:9091/metrics | head -20
```

---

### Step 5: Configure Alert Rules

**File**: `config/prometheus-alert-rules.yaml`

Copy the content from `config/rag-alerting-rules.yaml`:

```yaml
rule_files:
  - '/path/to/openclaw/config/rag-alerting-rules.yaml'

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['localhost:9093']
```

**Alert Thresholds**:
- ⚠️ Warning: RAG P95 latency > 1000ms or failure rate > 5%
- 🚨 Critical: RAG P95 latency > 2000ms or failure rate > 20%
- ℹ️ Info: Index growth > 100MB/day or relevance score Q25 < 0.5

---

### Step 6: Import Grafana Dashboard

1. **Access Grafana UI**: http://localhost:3000
2. **Menu**: Dashboards → New → Import
3. **Upload JSON**: Select `config/grafana-rag-dashboard.json`
4. **Configure**:
   - Select Prometheus datasource
   - Dashboard name: "OpenClaw RAG Performance"
   - Save

**Dashboard Panels**:
1. Search Latency Distribution (P50/P95/P99)
2. Success Rate Trend
3. Index Size (donut chart)
4. Vector Count (stat card)
5. Embedding Time
6. Vector Search Time
7. Relevance Scores Distribution

---

## Integration Points

### Where RAG Searches Happen

Update these locations to use `ragMonitor.search()`:

1. **Agent Tool Execution** → `src/agents/tool-executor.ts`
2. **Knowledge Retrieval** → `src/knowledge/retrieval.ts`
3. **Document Search** → `src/documents/search.ts`
4. **Chat Context** → `src/chat/context-builder.ts`

### Index Metadata Updates

When updating the RAG index, call:

```typescript
ragMonitor.setIndexMetadata(
  indexSizeInBytes,   // e.g., 52428800 (50MB)
  vectorCount         // e.g., 10000
);
```

---

## Metrics Explained

### Search Performance

- **rag_search_duration_ms** (histogram)
  - Buckets: 10, 50, 100, 500, 1000, 2000, 5000 ms
  - Labels: `query_type`, `success`
  - What: Total search duration from query to results

- **rag_search_success_total** (counter)
  - Labels: `query_type`, `result_count`, `success`
  - What: Count of successful/failed searches

### Component Performance

- **rag_embedding_time_ms** (histogram)
  - Buckets: 10, 50, 100, 500, 1000, 2000 ms
  - Labels: `model_type`
  - What: Query embedding (vectorization) duration

- **rag_vector_search_time_ms** (histogram)
  - Buckets: 5, 20, 50, 100, 500, 1000 ms
  - Labels: `search_type`, `k` (top-k value)
  - What: Vector database search duration

### Index Health

- **rag_index_size_bytes** (gauge)
  - What: Current RAG index file size

- **rag_index_vector_count** (gauge)
  - What: Number of vectors in the index

### Quality Metrics

- **rag_relevance_scores** (histogram)
  - Buckets: 0.1, 0.3, 0.5, 0.7, 0.85, 0.95
  - Labels: `query_type`
  - What: Distribution of document relevance scores

---

## Testing & Validation

### Unit Test

```typescript
import { MonitoredRAGSearch } from '../src/monitoring/rag-monitor';
import { register } from 'prom-client';

describe('RAG Monitor', () => {
  let ragMonitor: MonitoredRAGSearch;

  beforeEach(() => {
    ragMonitor = new MonitoredRAGSearch();
    register.clear();
  });

  it('should track successful RAG search', async () => {
    const result = await ragMonitor.search({
      queryType: 'test',
      query: 'test query',
      topK: 5
    });

    expect(result.success).toBe(true);
    expect(result.documents.length).toBeGreaterThan(0);
  });

  it('should export metrics in Prometheus format', async () => {
    const metrics = await register.metrics();
    expect(metrics).toContain('rag_search_duration_ms');
    expect(metrics).toContain('rag_search_success_total');
  });
});
```

### Integration Test

```bash
# 1. Start exporter
node -r ts-node/register src/monitoring/prometheus-exporter.ts

# 2. In another terminal, verify metrics endpoint
curl http://127.0.0.1:9091/metrics

# 3. Run sample search operations
node -r ts-node/register tests/rag-search-load.ts

# 4. Check Grafana dashboard for metrics
# Should see data points appearing in real-time
```

### Manual Verification

```bash
# Check metrics are being exposed
curl -s http://127.0.0.1:9091/metrics | grep rag_search

# Check Prometheus scrape config
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | select(.labels.job == "openclaw-rag-metrics")'

# Check alerts are defined
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[] | select(.name == "openclaw_rag_monitoring")'
```

---

## Performance Baselines

**Expected Performance** (with typical RAG setup):

| Metric | P50 | P95 | P99 |
|--------|-----|-----|-----|
| Search Duration | 50-100ms | 200-500ms | 500-1000ms |
| Embedding Time | 30-50ms | 100-200ms | 200-300ms |
| Vector Search Time | 10-20ms | 50-100ms | 100-200ms |

**Alerts Trigger At**:
- P95 Latency > 1000ms (warning) or > 2000ms (critical)
- Failure Rate > 5% (warning) or > 20% (critical)
- Index growth > 100MB/day (info)

---

## Next Steps

1. **Immediate** (This session):
   - [ ] Install prom-client dependency
   - [ ] Integrate MonitoredRAGSearch into agent execution
   - [ ] Start Prometheus exporter
   - [ ] Configure Prometheus scrape job

2. **Week 1-2**:
   - [ ] Implement actual RAG service integration (replace placeholders in rag-monitor.ts)
   - [ ] Load test with realistic queries
   - [ ] Validate alert thresholds based on actual performance
   - [ ] Grafana dashboard tuning

3. **Week 3+** (P1.2/P1.3):
   - Guardian metrics dashboard
   - Test coverage enhancement
   - Performance optimization based on collected data

---

## Rollback Plan

If issues occur:

```bash
# Disable Prometheus exporter without removing code
export DISABLE_PROMETHEUS_EXPORTER=1

# Uninstall prom-client
npm uninstall prom-client

# Remove monitoring code (revert commits)
git revert <commit-hash>
```

---

## Documentation

- Prometheus Metrics: https://prometheus.io/docs/concepts/metric_types/
- prom-client: https://github.com/siimon/prom-client
- Grafana Dashboard: https://grafana.com/docs/grafana/latest/dashboards/
- Alert Rules: https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/

---

**Implementation Owner**: Claude Haiku 4.5
**Review Checklist**:
- [ ] Code compiles without errors
- [ ] Metrics exported in correct format
- [ ] Prometheus scrape target is healthy
- [ ] Grafana dashboard displays data
- [ ] Alert rules are active
- [ ] 1h monitoring without false positives
