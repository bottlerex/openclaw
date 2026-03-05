# OpenClaw 安全防護行動計劃 — P0 優先級

**開始日期**: 2026-03-05
**優先級**: 🔴 CRITICAL - 24小時內執行
**根據**: Kaspersky 安全審計報告

---

## 📋 立即執行清單 (今天)

### 1. 撤銷已暴露的 API 密鑰

**需要撤銷的密鑰** (已在 .env 中暴露，現需立即更新):

| 服務 | 密鑰類型 | 狀態 | 行動 | 優先級 |
|------|---------|------|------|--------|
| **Telegram** | BOT_TOKEN: 8529641247:AAE... | ⚠️ 暴露 | 撤銷並生成新 token | 🔴 |
| **Google OAuth** | CLIENT_SECRET: GOCSPX-Gak0... | ⚠️ 暴露 | 撤銷、生成新 OAuth 憑證、更新 redirect URI | 🔴 |
| **Brave Search** | API_KEY: BSABkEen0Xsr... | ⚠️ 暴露 | 撤銷並生成新 key | 🔴 |
| **OpenClaw Gateway** | GATEWAY_TOKEN: gorj_VLdDi... | ⚠️ 暴露 | 重新生成 | 🔴 |

**執行步驟:**

```bash
# 1. Telegram Bot — 撤銷舊 token，創建新 bot
#    連結: https://t.me/BotFather
#    指令: /revoke (原 bot) → /newbot (建立新 bot)

# 2. Google OAuth — 撤銷並重新授權
#    連結: https://myaccount.google.com/permissions
#    行動: 移除 "OpenClaw" 應用授權
#    然後: 重新執行 OAuth 流程生成新 credentials

# 3. Brave Search API — 重新生成密鑰
#    連結: https://api.search.brave.com/res/v1/web/search
#    行動: 登入帳戶，regenerate API key

# 4. OpenClaw Gateway Token — 本地生成
openssl rand -base64 32
#    複製新 token 至 .env (OPENCLAW_GATEWAY_TOKEN)
```

---

### 2. 啟用身份驗證機制

**目標**: 防止未授權訪問 Gateway API

**配置位置**: `.env` 或啟動參數

```bash
# 在 .env 中添加或更新
OPENCLAW_AUTH_ENABLED=true
OPENCLAW_AUTH_MODE=bearer_token  # 使用 Bearer token
OPENCLAW_ADMIN_TOKEN=$(openssl rand -base64 32)  # 生成新管理員 token
```

**驗證方法**:
```bash
# 未提供 token 時應返回 401 Unauthorized
curl -X GET http://localhost:18791/api/agents

# 提供正確 token 時應返回 200 OK
curl -X GET \
  -H "Authorization: Bearer ${OPENCLAW_ADMIN_TOKEN}" \
  http://localhost:18791/api/agents
```

---

### 3. 限制網絡訪問 (防火牆)

**當前狀況**: `OPENCLAW_GATEWAY_BIND=lan` — 可能對 LAN 開放

**修正步驟**:

```bash
# 更新 .env
OPENCLAW_GATEWAY_BIND=localhost  # 改為只接受本地連接

# 或使用防火牆規則（macOS）
sudo pfctl -f /etc/pf.conf  # 配置規則

# 臨時測試: 關閉埠訪問
sudo pfctl -d  # 停用 pf（如需要）
```

**預期結果**:
- ❌ `curl http://192.168.1.100:18791/api/agents` → 連接被拒
- ✅ `curl http://localhost:18791/api/agents` → 正常

---

### 4. 證書存儲加密 (建議)

**長期方案**: 遷移敏感數據至系統密鑰鏈 (macOS Keychain)

```bash
# 使用 security 命令存儲密鑰
security add-generic-password \
  -a openclaw \
  -s "TELEGRAM_BOT_TOKEN" \
  -w "YOUR_TOKEN_HERE"

# 讀取密鑰
security find-generic-password -a openclaw -s "TELEGRAM_BOT_TOKEN" -w
```

**或使用 .env.enc + 密碼保護** (簡化版):
```bash
# 加密 .env（需要密鑰管理）
gpg --symmetric --cipher-algo AES256 /Users/rexmacmini/openclaw/.env
# 產生 .env.gpg

# 啟動時解密
gpg --decrypt /Users/rexmacmini/openclaw/.env.gpg > /tmp/.env
```

---

## ✅ 已完成項目

- [x] `.env.example` 建立 — 安全範本，不含敏感值
- [x] `.gitignore` 驗證 — .env 不會意外提交
- [x] 檔案權限確認 — 600 (僅所有者可讀)

---

## ⏭️ 優先級 2 (本週執行)

| 項目 | 時間 | 狀態 |
|------|------|------|
| 應用 Kaspersky 安全補丁 | 2026-03-15 | 📅 預計 |
| 實施網絡隔離 (VPN) | 1-2 小時 | ⏳ 待執行 |
| 審計所有日誌檔案 | 1 小時 | ⏳ 待執行 |
| 部署入侵檢測系統 (IDS) | 2-3 小時 | ⏳ 待執行 |

---

## 📊 合規檢查清單

- [ ] 所有已暴露密鑰已撤銷 (Telegram, Google, Brave, Gateway)
- [ ] 身份驗證已啟用 (auth_enabled: true)
- [ ] 公網訪問已禁用 (GATEWAY_BIND: localhost)
- [ ] .env.example 已提交至 git
- [ ] 本地測試驗證通過 (401 Unauthorized + 200 OK with token)
- [ ] 日誌已檢查無異常訪問跡象

---

## 🎯 成功指標

✅ **P0 防護完成條件**:
1. 新 API 密鑰已在所有服務中註冊
2. Gateway 返回 401 無身份驗證
3. localhost 外的 IP 連接被拒 (防火牆/配置層級)
4. .env 檔案已標記為敏感 (.gitignore, chmod 600)

✅ **預期影響**:
- 消除明文憑證暴露風險 (Kaspersky: Level 8.8)
- 防止未授權 API 訪問 (CVSS 降低 3-4 級)
- 保護 1000+ 暴露實例的短期風險

---

**簽核**: Claude Code
**完成目標時間**: 2026-03-05 18:00 UTC (6 小時)
**驗證**: 運行安全測試腳本確認所有檢查點

---

## 緊急聯繫

如發現安全事件:
1. 立即停止 OpenClaw Gateway: `docker-compose stop openclaw-gateway`
2. 保存日誌: `cp ~/.openclaw/logs/* ~/backup/logs-$(date +%Y%m%d-%H%M%S)/`
3. 執行完整安全掃描: OpenVAS / Snort
4. 通知: Security Team
