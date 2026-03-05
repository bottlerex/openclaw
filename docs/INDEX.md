# OpenClaw 文檔索引

## 📋 核心文檔

### 系統設計
- **ARCHITECTURE.md** (13K) - 五層系統架構、組件設計、資料流
- **README.md** (8.1K) - 快速開始、功能概述

### 運維指南
- **RUNBOOK.md** (10K) - 故障排查、故障轉移、監控指南
- **PERFORMANCE.md** (7.3K) - 效能基準、優化建議、限制

### 安全與專案
- **SECURITY_MITIGATION_P0_20260305.md** (4.9K) - P0 安全缓解措施
- **REX-AGENT.md** (8.6K) - Agent 設計與行為
- **BRAND_ECOSYSTEM_RESEARCH_20260305.md** (7.8K) - 品牌生態研究

## 📂 工作區配置

- `config/workspace/` - OpenClaw 工作區配置
  - `IDENTITY.md` - 身份定義
  - `MEMORY.md` - 長期記憶
  - `USER.md` - 用戶信息
  - `AGENTS.md` - Agent 團隊
  - `HEARTBEAT.md` - 心跳監控

## 🔧 監控與自動化

### P0 Recovery System
- Layer 1: 自動恢復監控 (5 個腳本)
- B1 Optimization: 環境硬化 (9 個環境變量)
- Cron: 每 1-5 分鐘檢查

**監控日誌**:
- `/tmp/p0-monitor.log` - P0 dispatcher
- `/tmp/websocket-heartbeat.log` - WebSocket 心跳
- `/tmp/websocket-reconnect.log` - WebSocket 重連

## 📊 檢查清單 (2026-03-05)

- ✅ API 響應時間: <10ms
- ✅ 資料庫連接: 正常 (45 張表)
- ✅ Telegram 輪詢: 無 409 錯誤
- ✅ 調度器: 7 個任務活躍
- ✅ P0 監控: 全部部署

---

**最後更新**: 2026-03-05 | **維護者**: Claude (自動更新)
