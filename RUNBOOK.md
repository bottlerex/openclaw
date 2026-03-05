# OpenClaw 運維手冊 (Runbook)

**版本**: 1.0 (2026-03-05)
**目標用戶**: 開發者、維護者
**參考**: ARCHITECTURE.md, openclaw-p0-remediation-hypothesis.md

---

## 快速診斷

### 最常見的問題

**症狀**: 「消息沒有回應」

```bash
# Step 1: 容器狀態
docker ps --filter "name=openclaw"
# 應該看到: openclaw-agent UP and healthy

# Step 2: Gateway 健康檢查
curl http://localhost:18789/health
# 應該返回: {"ok":true,"status":"live"}

# Step 3: 查看日誌
docker logs openclaw-agent --tail 50 | grep -E "error|ERROR|failed"

# Step 4: 若有 P0 錯誤，參考 P0 故障排查
```

---

## P0 故障排查

### P0.1: Telegram Health-Monitor 每 30 分鐘卡住

**症狀**:
```
[health-monitor] [telegram:default] health-monitor: restarting (reason: stuck)
```
每 30 分鐘出現一次，Telegram bot 短暫不可用。

**原因**: Health check 邏輯無超時，某操作 hanging

**診斷**:
```bash
# 計算發生頻率
docker logs openclaw-agent --since 2h | grep "stuck" | wc -l
# 若接近 4 次 (2h = 120min, 每 30min 一次) → 確認

# 檢查是否影響功能
curl -s http://localhost:18789/telegram/health
# 若無法連接 → health-monitor 已掛起
```

**修復**:
1. **立即恢復**: 重啟 Telegram provider
   ```bash
   curl -X POST http://localhost:18789/telegram/stop
   sleep 5
   curl -X POST http://localhost:18789/telegram/start
   ```

2. **永久修復**: 見 `openclaw-p0-remediation-hypothesis.md` P0.1
   - 改為 5 秒超時 + graceful restart

**防護**: 自動恢復系統每 5 分鐘檢查並自動修復

---

### P0.2: Telegram 409 Conflict (多實例)

**症狀**:
```
getUpdates conflict: Call to 'getUpdates' failed! (409: Conflict:
terminated by other getUpdates request)
```
偶發，導致 Telegram bot 無法接收消息。

**原因**: 2 個或以上 Telegram provider 同時綁定同一 bot token

**診斷**:
```bash
# 檢查有多少 Telegram 實例在運行
docker logs openclaw-agent | grep "starting provider" | grep -i telegram | tail -5

# 檢查 config 中有多少 agent 綁定 Telegram
find config/agents -name "auth-profiles.json" | \
  xargs grep -l "telegram" | wc -l
# 應該 = 1 (只有 main agent)
```

**修復**:
1. **立即恢復**: 停止 + 重啟 Telegram
   ```bash
   curl -X POST http://localhost:18789/telegram/stop
   sleep 10  # 等待舊連接完全關閉
   curl -X POST http://localhost:18789/telegram/start
   ```

2. **查找根因**:
   ```bash
   # 檢查是否有多個 agent 配置
   grep -r "telegram" config/agents/*/auth-profiles.json
   # 應該只有 main agent 有配置
   ```

3. **永久修復**: 見 `openclaw-p0-remediation-hypothesis.md` P0.2
   - 添加 instance lock 機制
   - 改進 graceful shutdown

**防護**: 自動恢復系統每 5 分鐘檢查並自動修復

---

### P0.3: WebChat Disconnect (code=1006)

**症狀**:
```
[ws] webchat connected conn=...
[ws] webchat disconnected code=1006 reason=n/a conn=...
```
連接立即斷線，無原因。WebChat UI 無法保持連接。

**原因**: WebSocket 無 heartbeat，長連接被 gateway 認為 dead

**診斷**:
```bash
# 計算斷線頻率
docker logs openclaw-agent --since 1h | grep "code=1006" | wc -l

# 檢查是否有記憶體洩漏
docker stats openclaw-agent --no-stream | grep -E "MEMORY|memory"

# 檢查 Gateway logs 中是否有 timeout 日誌
docker logs openclaw-agent | grep -i "timeout\|close"
```

**修復**:
1. **立即恢復**: 重啟 Gateway
   ```bash
   curl -X POST http://localhost:18789/gateway/restart
   # 或
   docker restart openclaw-agent
   ```

2. **臨時對策**: 客戶端改為使用指數退避重連
   ```javascript
   // 客戶端代碼
   const reconnect = (attempt = 0) => {
     const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
     setTimeout(() => ws.connect(), delay);
   };
   ```

3. **永久修復**: 見 `openclaw-p0-remediation-hypothesis.md` P0.3
   - 添加 WebSocket heartbeat (30s)
   - 改進 reconnect 邏輯
   - 監控內存使用

**防護**: 自動恢復系統每 5 分鐘檢查並自動修復

---

### P0.4: Tools Allowlist Miss + Timeout Not Found

**症狀**:
```
exec denied: allowlist miss
exec failed: /usr/local/bin/openclaw-shell.sh: timeout: not found
```
執行工具時失敗，可能是新命令未被允許或 Docker 缺少依賴。

**原因**:
- allowlist 未包含新執行路徑
- Docker image 缺少 `timeout` 命令 (coreutils)

**診斷**:
```bash
# 檢查最近執行失敗
docker logs openclaw-agent --since 1h | grep "exec.*failed" | head -5

# 檢查 timeout 命令是否存在
docker exec openclaw-agent which timeout
# 若無輸出 → 缺失

# 檢查 allowlist 配置
jq '.rules[] | .path' config/exec-approvals.json | head -20
```

**修復**:
1. **立即恢復**: 添加缺失路徑到 allowlist
   ```bash
   # 編輯 config/exec-approvals.json
   # 添加:
   {
     "path": "/usr/local/bin/openclaw-shell.sh",
     "allowed": true,
     "requireApproval": false
   }

   # 重載配置
   curl -X POST http://localhost:18789/config/reload
   ```

2. **修復缺失命令**:
   ```bash
   # 更新 Dockerfile
   RUN apt-get update && apt-get install -y coreutils

   # 重建 image
   docker build -t openclaw-agent .
   docker restart openclaw-agent
   ```

3. **永久修復**: 見 `openclaw-p0-remediation-hypothesis.md` P0.4
   - 自動 allowlist 同步
   - Docker image 檢查清單

**防護**: 自動恢復系統每天執行 allowlist 同期

---

## P1 問題排查

### Telegram 無法發送消息

**症狀**: 消息進入但無回應

```bash
# 檢查 Telegram 認證
curl http://localhost:18789/telegram/getMe
# 應該返回 bot info

# 檢查是否有待發送隊列積壓
curl http://localhost:18789/telegram/queue
# 若隊列很長 → 發送速率限制

# 檢查 Telegram API 限制
docker logs openclaw-agent | grep -i "rate\|limit\|429"
```

**臨時對策**:
```bash
# 減緩發送速率
curl -X POST http://localhost:18789/telegram/setRateLimit \
  -d '{"messagesPerSecond": 1}'
```

---

### Agent 回應緩慢

**症狀**: 命令執行時間 > 30 秒

```bash
# 檢查代理負載
docker stats openclaw-agent --no-stream

# 檢查是否有慢查詢
docker logs openclaw-agent | grep -E "slow|timeout|long-running"

# 檢查 RAG 搜索性能
curl -X POST http://localhost:18789/rag/benchmark \
  -d '{"query": "test"}'
```

**臨時對策**:
- 減少 RAG 搜索深度 (top-K)
- 優化並發代理數量
- 升級模型延遲 (改用 Gemini)

---

## 常見操作

### 查看容器日誌

```bash
# 最近 100 行
docker logs openclaw-agent -n 100

# 實時日誌
docker logs -f openclaw-agent

# 特定時間範圍
docker logs openclaw-agent --since 2h --until 30m

# 過濾特定關鍵字
docker logs openclaw-agent | grep "error\|ERROR\|failed"
```

### 容器重啟

```bash
# 軟重啟 (graceful shutdown)
curl -X POST http://localhost:18789/shutdown
sleep 10
docker restart openclaw-agent

# 硬重啟
docker restart openclaw-agent

# 驗證
curl http://localhost:18789/health
```

### 配置重載

```bash
# 重載所有配置（無需重啟）
curl -X POST http://localhost:18789/config/reload

# 檢查配置狀態
curl http://localhost:18789/config/status
```

### 執行 Cron 任務

```bash
# 手動執行特定任務
curl -X POST http://localhost:18789/cron/run \
  -d '{"jobId": "telegram-auto-recovery"}'

# 檢查任務狀態
curl http://localhost:18789/cron/jobs | jq '.[] | {name, lastStatus}'
```

### 清理日誌

```bash
# 日誌文件位置
ls -lh /home/node/.openclaw/logs/

# 清理舊日誌 (保留最近 7 天)
find /home/node/.openclaw/logs -mtime +7 -delete

# 或使用日誌輪轉 (cron job)
curl -X POST http://localhost:18789/cron/run \
  -d '{"jobId": "log-rotate"}'
```

---

## 性能調優

### 增加並發能力

```json
// config/openclaw.json
{
  "agents": {
    "defaults": {
      "maxConcurrent": 8,  // 增加到 8
      "subagents": {
        "maxConcurrent": 16  // 並發子任務
      }
    }
  }
}
```

### 優化 RAG 搜索

```bash
# 調整搜索深度 (top-K)
curl -X POST http://localhost:18789/rag/config \
  -d '{"topK": 5, "scoreThreshold": 0.7}'

# 重建索引（清理 + 重新索引）
curl -X POST http://localhost:18789/rag/rebuild
```

### 內存優化

```bash
# 監控內存使用
watch -n 5 'docker stats openclaw-agent --no-stream'

# 若內存持續增長 → 可能有洩漏
# 檢查日誌中的異常
docker logs openclaw-agent | grep -i "memory\|leak"

# 重啟代理
docker restart openclaw-agent
```

---

## 監控告警

### 自動告警條件

| 條件 | 等級 | 行動 |
|------|------|------|
| P0 自動修復成功 | INFO | Telegram 通知 |
| P0 自動修復失敗 3+次 | ERROR | Telegram @RexSu + 日誌 |
| 內存使用 > 85% | WARN | 監控告警 |
| Gateway 無回應 | CRITICAL | 自動重啟 |
| RAG 搜索延遲 > 2s | WARN | 日誌記錄 |

### 查看告警

```bash
# 最近告警（從 Telegram 備份）
grep -i "alert\|error\|critical" ~/.openclaw/telegram-*.log | tail -20

# 獲取即時指標
curl http://localhost:18789/metrics
```

---

## 備份 & 恢復

### 備份配置

```bash
# 備份 config 目錄
tar -czf openclaw-config-backup-$(date +%Y%m%d).tar.gz config/

# 備份 SQLite DB
cp config/knowledge.db config/knowledge-backup-$(date +%Y%m%d).db
```

### 恢復配置

```bash
# 恢復備份
tar -xzf openclaw-config-backup-20260305.tar.gz

# 重啟應用
docker restart openclaw-agent

# 驗證
curl http://localhost:18789/health
```

---

## 故障清單

遇到問題時按順序檢查：

```
□ 容器運行狀態? → docker ps
□ Gateway 健康? → curl /health
□ 日誌有 P0 錯誤? → docker logs | grep stuck/409/1006/exec
  □ 是 → 參考 P0 故障排查
  □ 否 → 檢查 P1 問題
□ P1 問題? → 檢查性能、日誌
□ 無法診斷? → 聯絡 Claude Code (auto-recovery system)
```

---

## 聯絡方式

**自動恢復系統**: 已部署，24/7 運行
- Telegram @RexSu_Openclaw_bot (告警)
- 日誌: docker logs openclaw-agent

**手動幫助**:
- 查看 openclaw-auto-recovery-system.md (監控系統)
- 查看 openclaw-p0-remediation-hypothesis.md (修復方案)
- 查看 ARCHITECTURE.md (系統設計)

---

**最後更新**: 2026-03-05
**審查週期**: 每週一
