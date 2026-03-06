# P1.1 Integration Checklist - RAG Performance Monitoring

**Date**: 2026-03-06
**Status**: Exporter Deployed ✅
**Next**: Complete integration chain

---

## Completed ✅

- [x] Design 7 Prometheus metrics for RAG monitoring
- [x] Implement MonitoredRAGSearch class (src/monitoring/rag-monitor.ts)
- [x] Implement PrometheusExporter (src/monitoring/prometheus-exporter.ts)
- [x] Create alert rules (config/rag-alerting-rules.yaml)
- [x] Create Grafana dashboard (config/grafana-rag-dashboard.json)
- [x] Write implementation guide (docs/P1_1_IMPLEMENTATION_GUIDE.md)
- [x] Install prom-client@15.0.0 dependency
- [x] Deploy Prometheus exporter startup script
- [x] Start exporter service (http://127.0.0.1:9091/metrics)
- [x] Verify metrics endpoint is working
- [x] Verify health check endpoint is working

---

## Pending Integration Steps

### Phase 1: Prometheus Configuration (30 min)

**Files**:
- Prometheus config location: `/Users/rexmacmini/openclaw/config/prometheus.yml` (or equivalent)

**Steps**:
1. [ ] Add OpenClaw RAG scrape job to Prometheus config
2. [ ] Add alert rules file path to Prometheus config
3. [ ] Reload Prometheus configuration
4. [ ] Verify Prometheus target is healthy

**Verification Commands**:
```bash
# Check Prometheus targets
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets'

# Check for prometheus-rag-metrics target
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | select(.labels.job == "openclaw-rag-metrics")'

# Verify metrics are scraped
curl http://localhost:9090/api/v1/query?query=rag_search_duration_ms | jq '.data.result'
```

---

### Phase 2: Grafana Dashboard Import (15 min)

**Steps**:
1. [ ] Access Grafana UI (http://localhost:3000)
2. [ ] Menu: Dashboards → Import
3. [ ] Upload `config/grafana-rag-dashboard.json`
4. [ ] Select Prometheus datasource
5. [ ] Verify all 7 panels display data

**Expected Panels**:
1. RAG Search Latency Distribution (P50/P95/P99)
2. Search Success Rate Trend
3. Index Size (donut chart)
4. Vector Count (stat card)
5. Embedding Time (histogram)
6. Vector Search Time (histogram)
7. Relevance Scores Distribution

---

### Phase 3: Agent Integration (1 hour)

**Files to Update**:
- `src/agents/agent-executor.ts` or `src/agents/tool-executor.ts`
- Application main entry point

**Changes Required**:

1. Import RAG monitor:
```typescript
import { ragMonitor } from '../monitoring/rag-monitor';
```

2. Wrap RAG search calls:
```typescript
async executeRAGSearch(query: string, options: any) {
  const result = await ragMonitor.search({
    queryType: options.type || 'general',
    query: query,
    topK: options.topK || 5
  });
  return result.documents; // Use result, not raw search
}
```

3. Initialize exporter at startup:
```typescript
import { exporter } from '../monitoring/prometheus-exporter';

async function main() {
  await exporter.start();
  // ... rest of startup
}
```

---

### Phase 4: Load Testing (30 min)

**Test Script** (to be created):
```bash
# Generate 100+ RAG queries to populate metrics
for i in {1..100}; do
  curl -X POST http://localhost:8888/api/agents/search \
    -d '{"query":"test query '$i'","topK":5}'
  sleep 0.1
done

# Wait for metrics to be scraped
sleep 35

# Verify metrics are populated
curl http://127.0.0.1:9091/metrics | grep rag_search_duration_ms_count
# Should show > 0

# Check Grafana dashboard
# Navigate to OpenClaw RAG Performance dashboard
# Should see latency distribution, success rates, etc.
```

---

### Phase 5: Alert Configuration (20 min)

**Steps**:
1. [ ] Prometheus is reading alert rules (config/rag-alerting-rules.yaml)
2. [ ] AlertManager is configured
3. [ ] Test alert firing (optional):
   ```bash
   # Generate high latency scenario
   # Verify alert appears in Prometheus
   curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.labels.alertname == "RAGSearchHighLatency")'
   ```

---

## Current Service Status

**Prometheus Exporter**:
- ✅ Running: http://127.0.0.1:9091
- ✅ Metrics endpoint: http://127.0.0.1:9091/metrics
- ✅ Health check: http://127.0.0.1:9091/health
- ✅ Log file: logs/prometheus-exporter.log

**Metrics Being Exported**:
- ✅ rag_search_duration_ms (histogram)
- ✅ rag_search_success_total (counter)
- ✅ rag_index_size_bytes (gauge)
- ✅ rag_index_vector_count (gauge)
- ✅ rag_embedding_time_ms (histogram)
- ✅ rag_vector_search_time_ms (histogram)
- ✅ process_resident_memory_bytes (gauge)
- ✅ process_uptime_seconds (counter)

---

## Files Added in This Session

| File | Type | Status |
|------|------|--------|
| src/monitoring/rag-monitor.ts | TypeScript | ✅ Committed |
| src/monitoring/prometheus-exporter.ts | TypeScript | ✅ Committed |
| scripts/start-rag-metrics.mjs | Node.js | ✅ Deployed |
| config/rag-alerting-rules.yaml | YAML | ✅ Committed |
| config/grafana-rag-dashboard.json | JSON | ✅ Committed |
| config/prometheus-rag-config.yml | YAML | 📋 To be integrated |
| docs/P1_1_IMPLEMENTATION_GUIDE.md | Markdown | ✅ Committed |

---

## Rollback Instructions (if needed)

```bash
# Stop exporter
pkill -f start-rag-metrics

# Revert commits
git revert b91a2960a

# Uninstall dependency
npm uninstall prom-client

# Remove monitoring directory
rm -rf src/monitoring/
```

---

## Timeline Summary

- [x] 15:00 - P1 planning document (commit 0bbda55e5)
- [x] 15:30 - P1.1 design and code (commit b91a2960a)
- [x] 15:45 - Install prom-client dependency
- [x] 16:00 - Deploy Prometheus exporter
- [x] 16:15 - Verify exporter endpoints
- [ ] 16:30 - Configure Prometheus scrape job
- [ ] 16:45 - Import Grafana dashboard
- [ ] 17:00 - Integrate with agent executor
- [ ] 17:30 - Load testing
- [ ] 18:00 - Final verification

**Estimated Total Time**: 2.5-3 hours for complete integration

---

## Success Criteria

P1.1 is complete when:

- [ ] ✅ Prometheus exporter running and healthy
- [ ] ✅ Metrics being scraped by Prometheus every 30s
- [ ] ✅ Grafana dashboard showing live metrics
- [ ] ✅ Alerts configured and functional
- [ ] ✅ Agent searches are instrumented with RAG monitor
- [ ] ✅ 1 hour of monitoring with <1% false positive alerts
- [ ] ✅ Performance baselines established (P50, P95, P99)

---

**Next Action**: Proceed with Phase 1 (Prometheus Configuration)
