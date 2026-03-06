#!/bin/bash

echo "🚨 OpenClaw RAG 告警驗證"
echo "═══════════════════════════════════════"

# 檢查 Prometheus 是否加載告警規則
echo -e "\n1️⃣  檢查 Prometheus 告警規則..."
curl -s http://127.0.0.1:9090/api/v1/rules | jq '.data.groups[] | select(.name == "openclaw_rag_monitoring") | .rules | length' 2>/dev/null || \
echo "⚠️  告警規則未加載 (需要配置 Prometheus alert.rules)"

# 檢查 AlertManager
echo -e "\n2️⃣  檢查 AlertManager..."
curl -s http://127.0.0.1:9093/-/healthy 2>/dev/null && \
echo "✅ AlertManager 運行中" || \
echo "⚠️  AlertManager 未運行"

# 檢查告警狀態
echo -e "\n3️⃣  檢查活躍告警..."
curl -s http://127.0.0.1:9090/api/v1/alerts | jq '.data.alerts | length' 2>/dev/null
echo "個活躍告警"

# 顯示 RAG 相關告警
echo -e "\n4️⃣  RAG 相關告警..."
curl -s http://127.0.0.1:9090/api/v1/alerts | jq '.data.alerts[] | select(.labels.component == "rag") | {alert: .labels.alertname, severity: .labels.severity}' 2>/dev/null || \
echo "⚠️  無活躍 RAG 告警"

echo -e "\n✅ 告警驗證完成"
