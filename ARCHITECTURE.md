# OpenClaw 架構文檔

**版本**: 1.0 (2026-03-05)
**狀態**: Production (Multi-channel Agent Orchestration)
**維護者**: Claude Code + Automated Systems

---

## 快速概覽

OpenClaw 是一個**多通道代理編排系統**，支援 Discord、Slack、LINE、WhatsApp 等平台，具備：
- 🤖 **代理自治**: Bounded autonomy (邊界內自主)
- 🛡️ **安全防護**: Runaway guard + Guardian watchdog 24/7
- 🧠 **知識檢索**: RAG 向量搜索 + Bedrock AI
- 🔗 **多通道**: Discord/Slack/LINE/WhatsApp 統一接口
- 📊 **隔離**: Workspace-based agent isolation

---

## 五層架構

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Channel Integration (通道集成)             │
│  ├─ Discord Bot                                     │
│  ├─ Slack Bolt App                                 │
│  ├─ Telegram Bot                                    │
│  ├─ LINE Bot                                        │
│  └─ WhatsApp Business API                           │
└─────────────────────────────────────────────────────┘
           ↓ WebSocket/HTTP
┌─────────────────────────────────────────────────────┐
│  Layer 2: Orchestration & Routing (編排 + 路由)     │
│  ├─ Bridge: 消息路由引擎                            │
│  ├─ Gateway: 中央通信樞紐 (WebSocket)              │
│  ├─ Workspace: Agent 隔離容器                       │
│  └─ Session Manager: 狀態管理                       │
└─────────────────────────────────────────────────────┘
           ↓ RPC / REST API
┌─────────────────────────────────────────────────────┐
│  Layer 3: Agent & Services (代理 + 服務)            │
│  ├─ Main Agent (主代理)                             │
│  ├─ Monitor Agent (監控)                            │
│  ├─ Code-Review Agent (評審)                        │
│  ├─ Tool Execution (工具執行)                       │
│  └─ RAG Service (知識檢索)                          │
└─────────────────────────────────────────────────────┘
           ↓ Model API / Vector DB
┌─────────────────────────────────────────────────────┐
│  Layer 4: AI & Knowledge (AI + 知識層)              │
│  ├─ Bedrock (AWS Claude integration)                │
│  ├─ Gemini API (Google models)                      │
│  ├─ RAG Vector Index (知識庫)                       │
│  └─ SQLite DB (會話 + 配置)                         │
└─────────────────────────────────────────────────────┘
           ↓ Metrics / Alerts
┌─────────────────────────────────────────────────────┐
│  Layer 5: Monitoring & Safety (監控 + 安全)        │
│  ├─ Guardian Watchdog (24/7 監控)                  │
│  ├─ Runaway Guard (逃脫防護)                        │
│  ├─ Health Checks (健康檢查)                       │
│  └─ Auto-Recovery (自動恢復)                       │
└─────────────────────────────────────────────────────┘
```

---

## 層級詳解

### Layer 1: 通道集成

**責任**: 接收來自各平台的消息，標準化為內部格式

**通道支援**:

| 通道 | 狀態 | 認證 | 特性 |
|------|------|------|------|
| Discord | ✅ Production | Bot Token | 實時、媒體支援 |
| Slack | ✅ Production | OAuth2 | 工作區隔離 |
| Telegram | ✅ Production | Bot Token | 全功能、文件支援 |
| LINE | ✅ Production | Channel Token | 日本市場優化 |
| WhatsApp | ⚠️ Beta | Business API | 高延遲、審核 |
| WebChat | ✅ Production | WebSocket | 直連開發測試 |

**配置**: `config/agents/main/auth-profiles.json`

---

### Layer 2: 編排 + 路由

**責任**: 消息路由、會話管理、工作區隔離

**核心組件**:

#### Bridge (消息路由)
```
消息進入 → 解析平台/用戶/內容 → 決定目標 Agent
  ↓
轉發到 Agent Workspace
  ↓
等待回應 → 轉換格式 → 發回原平台
```

**檔案**: `scripts/claude-bridge.sh` + `scripts/claude-bridge-*.sh`

#### Gateway (中央樞紐)
```
所有 WebSocket 連接 → Gateway (port 18789)
  ├─ 認證 (WebSocket auth)
  ├─ 路由消息到 Workspace
  ├─ 管理連接狀態
  └─ 健康檢查 (/health endpoint)
```

**特性**:
- ✅ Heartbeat (防 timeout)
- ✅ Reconnect logic (自動重連)
- ✅ Message queuing (防丟失)
- ❌ 不支援多實例 (single-instance 設計)

#### Workspace (隔離容器)
```
每個 Agent = 獨立 Workspace
  ├─ 隔離文件系統: /home/node/.openclaw/workspace-<name>/
  ├─ 隔離進程
  ├─ 隔離會話
  └─ 獨立 RPC 端口
```

**已部署的 Workspaces**:
- `main`: 主代理 (port 18789)
- `monitor`: 監控 (獨立執行)
- `code-review`: 代碼評審 (獨立執行)

---

### Layer 3: 代理 + 服務

**責任**: 實際的邏輯處理，工具執行，決策

**Main Agent**:
- 入口點（接收所有消息）
- 決定路由：local 處理、轉發 monitor/code-review、執行工具
- 調用 RAG 進行知識檢索

**Monitor Agent**:
- 每 5-30 分鐘定期檢查（Cron jobs）
- 系統狀態報告 (uptime, disk, backups)
- 日誌分析 + 告警

**Code-Review Agent**:
- 接收代碼審查請求
- 分析代碼品質、安全性
- 返回評論

**Tool Execution**:
```
執行請求 → 檢查 allowlist (exec-approvals.json)
  ↓
驗證沙箱 (sandbox security)
  ↓
執行命令 (timeout 保護)
  ↓
返回結果或錯誤
```

**已知工具**:
- `read`: 讀取文件
- `write`: 寫入文件
- `edit`: 編輯文件
- `exec`: 執行命令
- `web_search`: Brave Search API
- `read_browser`: Playwright (網頁瀏覽)

**RAG Service** (`scripts/rag-*.mjs`):
```
add_document → 向量化 → 存入 SQLite vector index
  ↓
search_query → 向量化 → 相似度搜索
  ↓
返回 top-K 相關文檔
```

---

### Layer 4: AI + 知識層

**責任**: 模型調用、知識檢索、持久化存儲

**模型支援**:

| 提供商 | 模型 | 狀態 | 用途 |
|--------|------|------|------|
| AWS Bedrock | Claude | ✅ | 主智能 |
| Google | Gemini 2.0 Flash | ✅ | 備用 / 多模態 |
| Anthropic | Claude 3 | ✅ | 備用 |

**API 配置**: `config/openclaw.json` → `models.providers`

**知識庫**:
- SQLite: `/home/node/.openclaw/knowledge.db`
- Vector Index: RAG 向量存儲
- 會話持久化: `config/agents/*/sessions/`

---

### Layer 5: 監控 + 安全

**責任**: 系統可靠性、防護逃脫、自動恢復

#### Guardian Watchdog
```
24/7 監控:
  ├─ 檢查各 Agent 是否响应
  ├─ 檢查資源使用 (memory, disk)
  ├─ 檢查通道連接狀態
  └─ 檢測異常 → 記錄 + 告警
```

**檔案**: `config/guardian.sh`
**特性**: 自動重啟 failing components

#### Runaway Guard
```
防止 Agent 超出邊界:
  ├─ 執行超時保護 (30s limit)
  ├─ Token limit (防止無限生成)
  ├─ 工具執行白名單 (allowlist)
  └─ 停止條件檢查 (應該結束時立即停止)
```

**實現**: `mac-agentd.cjs` (第 2 階段實現)

#### Health Checks
```
每 5 分鐘:
  ├─ 掃描日誌 (stuck/409/1006/exec failed)
  ├─ 自動修復 (restart/reconnect)
  └─ 生成報告 → Telegram 告警
```

**自動恢復系統**: 見 `openclaw-auto-recovery-system.md`

---

## 數據流示例

### 用戶發送 Discord 消息

```
1. Discord 用戶發送: "查詢最新 OpenClaw 文章"
   ↓
2. Discord Bot 接收 (Layer 1)
   ↓
3. Bridge 解析:
   - 平台: discord
   - 用戶: @username
   - 內容: "查詢..."
   ↓
4. Gateway 路由 → Main Agent Workspace (Layer 2)
   ↓
5. Main Agent 決策:
   a) 調用 RAG.search("OpenClaw") → 獲取文檔
   b) 調用 tools.web_search("OpenClaw 2026") → 獲取新文章
   c) Bedrock Claude 總結 (Layer 4)
   ↓
6. Bridge 格式化回應 → Discord (Layer 1)
   ↓
7. Guardian 記錄執行時間 (Layer 5)
```

---

## 配置層級結構

```
config/
├── openclaw.json                    (全局配置)
├── agents/
│   ├── main/
│   │   ├── auth-profiles.json      (認證)
│   │   └── sessions/               (會話)
│   ├── monitor/
│   └── code-review/
├── cron/
│   └── jobs.json                   (Cron 任務)
├── workspace/
│   └── .openclaw/                  (workspace 狀態)
├── exec-approvals.json             (工具白名單)
└── scripts/
    ├── telegram-auto-recover.sh    (自動恢復)
    ├── openclaw-health-*.sh        (健康檢查)
    └── rag-*.mjs                   (知識檢索)
```

---

## 關鍵決策與取捨

### 決策 1: 單實例 Gateway

**決策**: Gateway 不支持多實例
**理由**: 簡化實現，避免分散式協調複雜性
**代價**: 單點故障 (mitigated by Guardian + auto-restart)

---

### 決策 2: Workspace 隔離

**決策**: 每個 Agent 獨立 Workspace
**理由**: 故障隔離，防止資源竞爭
**代價**: 進程數增加

---

### 決策 3: Bounded Autonomy

**決策**: Agent 不能無限自主決策
**理由**: 防止逃脫，控制成本
**實現**:
- 執行時間限制 (30s)
- Token 限制 (8K output)
- 工具白名單
- 用戶確認機制

---

### 決策 4: RAG Over Fine-tuning

**決策**: 使用 RAG 檢索而非微調模型
**理由**: 快速更新知識，成本低，效果好
**代價**: 推理成本稍高

---

## 性能特性

| 指標 | 目標 | 當前 | 狀態 |
|------|------|------|------|
| 消息延遲 | <2s | ~1-1.5s | ✅ |
| 代理響應 | <10s | ~5-8s | ✅ |
| 並發會話 | 100+ | ~50 | ⚠️ |
| 可用性 | 99.5% | ~95% (P0 故障) | ⚠️ |
| RAG 延遲 | <500ms | ~300-400ms | ✅ |

**P0 故障** (待修復):
- Telegram health-monitor stuck (30min 週期)
- WebSocket disconnect code=1006
- Tools allowlist miss + timeout not found
- Telegram 409 multi-instance conflict

見: `openclaw-p0-remediation-hypothesis.md`

---

## 已知限制

| 限制 | 影響 | 是否阻塞 |
|------|------|---------|
| Gateway 單實例 | 單點故障 | ⚠️ (Guardian mitigates) |
| WhatsApp Beta | 高延遲、限流 | 🔴 (不生產用) |
| 執行超時 30s | 長操作不支持 | ⚠️ (async tasks 繞過) |
| RAG 僅文本 | 無圖像知識 | 🟢 (次要) |
| Bedrock latency | 首次調用慢 | 🟢 (可緩存) |

---

## 擴展點

### 新通道添加

**步驟**:
1. 實現 Channel Provider (SDK integration)
2. 註冊到 Bridge (message normalization)
3. 添加 auth-profiles.json 配置
4. 測試路由 + 回應

**例子**: 新增 Matrix/Mattermost

---

### 新 Agent 添加

**步驟**:
1. 創建新 Workspace: `/home/node/.openclaw/workspace-<name>`
2. 配置 `config/agents/<name>/`
3. 在 Bridge 中添加路由規則
4. 部署 RPC server

**例子**: PDF 分析 Agent

---

### 新工具集成

**步驟**:
1. 實現工具邏輯 (tool-wrapper-proxy.js)
2. 添加到 allowlist (`config/exec-approvals.json`)
3. 文檔化 (TOOLS.md)
4. 測試執行

**例子**: 新增 GitHub API 工具

---

## 部署架構

```
Docker Container (openclaw-agent)
  ├─ Node.js Runtime
  ├─ Gateway (WebSocket, port 18789)
  ├─ Main Agent Workspace
  ├─ Monitor Agent Workspace
  ├─ Code-Review Agent Workspace
  ├─ Cron Daemon (定期任務)
  ├─ Guardian Watchdog (24/7)
  └─ Auto-Recovery System (監控 + 自動修復)

External Services
  ├─ Bedrock (AWS)
  ├─ Gemini API (Google)
  ├─ Discord/Slack/Telegram APIs
  └─ Brave Search API

Persistent Storage
  ├─ SQLite (knowledge + sessions)
  └─ JSON configs
```

**部署方式**: Docker container on Mac mini (OrbStack)

---

## 下一步

### 短期 (1-2 週)

- ✅ P0 修復 (自動恢復系統實施)
- ✅ 測試覆蓋 (達成 passing)
- ⏳ 文檔化完成

### 中期 (1 個月)

- P1 優化 (RAG、Guardian metrics、性能)
- 新通道支援完整化

### 長期 (3-6 個月)

- 多實例 Gateway (分散式設計)
- 完整 WhatsApp 支持
- 性能基準優化

---

**最後更新**: 2026-03-05
**下一次審查**: 2026-03-12
