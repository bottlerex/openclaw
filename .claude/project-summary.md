# OpenClaw 概要

> 上次更新: 2026-03-14 | 有變更時 Claude 應自動更新此檔

## 架構

5 層：Channels(13+平台) → Gateway(WS:18789) → Agent Runtime(Pi agent RPC) → Apps/Nodes → Tools。Docker 部署於 Mac mini。

## 目錄結構

- `src/gateway/server-channels.ts` — WebSocket gateway
- `src/routing/resolve-route.ts` — 訊息路由
- `src/monitoring/prometheus-exporter.ts` — 監控
- `config/openclaw.json` — 主設定
- `config/exec-approvals.json` — 工具白名單
- `config/agents/` — Agent 設定
- `scripts/` — 80+ shell 腳本（bridge, monitor, health, guardian）
- `mac-agentd.cjs` — macOS daemon
- `docker-compose.yml` — 4 服務（openclaw-agent, nginx, squid, browser）

## 技術棧

TypeScript + Node.js >=22 + Express + WebSocket + pnpm
AI: Bedrock Claude + Gemini + Ollama
Storage: SQLite + LanceDB(向量)
Messaging: Discord.js, Slack Bolt, grammy(TG), LINE SDK, Baileys(WA)

## 服務

| 服務 | Port | 說明 |
|------|------|------|
| Gateway | 18789 | WebSocket control plane |
| Web | 3457 | WebChat |
| nginx | — | TLS proxy |
| squid | — | HTTP proxy |

## 安全

ED25519 簽名認證 + 4 層 exec 權限 + 30s 執行逾時 + 8K output token 限制。
