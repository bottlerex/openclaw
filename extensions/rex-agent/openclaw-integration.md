# Rex-Agent Integration Guide for OpenClaw

## Overview
This guide enables OpenClaw agents to use rex-bot's three-tool architecture:
1. `run_command` - Shell execution via mac-agentd
2. `analyze_code` - Code analysis via Gemini 2.5 Flash  
3. `dev_task` - Complex development via Claude Session Bridge

## Integration Methods

### Method A: Agent System Prompt Integration

Add to agent's system.md or system prompt:

```
你是 Rex Bot，Rex 的個人 AI 助手，運行在 Mac mini 上。

你的能力：
1. run_command — 執行 shell 命令(Docker、檔案、系統監控、Git)
2. analyze_code — 代碼分析/解釋/review (Gemini 處理)
3. dev_task — 複雜開發任務 (Claude 處理)

環境: macOS Mac mini, OrbStack, /Users/rexmacmini/

規則:
- 系統命令 → run_command
- 代碼分析 → analyze_code  
- 開發任務 → dev_task
- 簡單問答 → 直接回答
```

### Method B: Extension-Based Loading

如果 OpenClaw 支持 plugin loader:
1. openclaw 自動掃描 extensions/ 目錄
2. 加載 rex-agent/index.js 
3. 通過 api.registerAgentTool() 註冊工具

## API Reference

### run_command
```
POST http://127.0.0.1:7777/shell/exec
Headers: Authorization: Bearer <token from ~/.agentd-token>
Body: {"command": "docker ps", "cwd": "/tmp"}
Response: {"ok": true, "output": "..."}
```

### analyze_code
```
Gemini API via GoogleGenerativeAI SDK
Model: gemini-2.5-flash
Input: question + optional file_path
Output: text analysis
```

### dev_task
```
POST http://localhost:7788/session/spawn
Body: {provider, cwd, prompt, maxTurns: 20}
Response: {sessionId, pid}
```

## Environment Setup

```bash
# On Mac mini:
export GEMINI_API_KEY="..."
export SESSION_BRIDGE_URL="http://localhost:7788"
# ~/.agentd-token is auto-detected from home directory
```

## Security

- 12 dangerous patterns blocked (rm -rf, mkfs, shutdown, etc.)
- Token authentication required for all mac-agentd calls
- Output limited to 100KB per command
- Rate limit: 100 requests/5min

## Testing

```bash
TOKEN=$(cat ~/.agentd-token)
curl -X POST http://127.0.0.1:7777/shell/exec \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "date"}'
```

