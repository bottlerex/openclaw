# Rex-Agent Extension for OpenClaw

Integration of rex-bot's three-tool architecture into OpenClaw for enhanced Mac mini automation and AI-assisted development.

## 📋 Overview

Rex-Agent provides OpenClaw with three specialized capabilities:

| Tool | Purpose | Engine |
|------|---------|--------|
| `run_command` | Shell execution on Mac mini | mac-agentd (:7777) |
| `analyze_code` | Code/architecture analysis | Gemini 2.5 Flash |
| `dev_task` | Complex development work | Claude + Session Bridge |

## 🚀 Quick Start

### Prerequisites
```bash
# On Mac mini:
export GEMINI_API_KEY="your-api-key"
export SESSION_BRIDGE_URL="http://localhost:7788"
cat ~/.agentd-token  # Should exist (auto-created by mac-agentd)
```

### Installation
```bash
# rex-agent already in: /Users/rexmacmini/openclaw/extensions/rex-agent/
npm install @google/generative-ai
```

### Manual Integration
Add to your OpenClaw agent's system prompt:

```markdown
你現在可以使用 Rex 工具：
- run_command(cmd) → 執行 Mac mini shell 命令
- analyze_code(q, file) → Gemini 代碼分析
- dev_task(task, project) → Claude 開發協助
```

## 🔧 Architecture

```
User Input (Telegram/HTTP)
    ↓
OpenClaw Agent
    ├─ run_command ──→ mac-agentd:7777 (/shell/exec) ──→ Shell
    ├─ analyze_code ─→ Gemini 2.5 Flash API ──→ Analysis
    └─ dev_task ────→ Session Bridge:7788 ──→ Claude Session
```

### Mac-agentd Integration

The `/shell/exec` endpoint handles command execution:

```
POST http://127.0.0.1:7777/shell/exec
Authorization: Bearer <token>
Content-Type: application/json

{
  "command": "docker ps",
  "cwd": "/tmp"  // optional
}

Response:
{
  "ok": true,
  "output": "container_id  status"
}
```

**Safety Features:**
- 12-pattern blacklist (rm -rf, mkfs, shutdown, etc.)
- 100KB output limit
- Token authentication required
- Command validation before execution

### Code Analysis Flow

```javascript
analyze_code({
  question: "Explain this function",
  file_path: "/path/to/file.py"
})
  ↓
Read file content (first 10KB)
  ↓
Call Gemini 2.5 Flash with context
  ↓
Return analysis text (max 4KB displayed)
```

### Development Task Dispatch

```javascript
dev_task({
  task: "Add error handling to function X",
  project: "personal-ai-assistant"
})
  ↓
Spawn Claude Session (/session/spawn)
  ↓
Return Session ID to user
  ↓
Claude works asynchronously
  ↓
Results pushed via Telegram when complete
```

## 📖 API Reference

### run_command(command, cwd?)
Execute shell command on Mac mini.

**Parameters:**
- `command` (string): Shell command to execute
- `cwd` (string, optional): Working directory

**Returns:**
```javascript
{
  ok: boolean,        // true if command succeeded
  output: string      // stdout + stderr (max 100KB)
}
```

**Examples:**
```javascript
// Docker management
await run_command("docker ps -q")
await run_command("docker logs openclaw-agent --tail 20")
await run_command("docker restart openclaw-agent")

// File operations
await run_command("ls -lh /Users/rexmacmini/Projects/")
await run_command("du -sh /Volumes/Black\\ Rex/*")

// System monitoring
await run_command("top -l 1 | head -20")
await run_command("df -h")
```

### analyze_code(question, file_path?)
Analyze code or technical concepts using Gemini.

**Parameters:**
- `question` (string): Analysis question or request
- `file_path` (string, optional): Path to code file

**Returns:**
```javascript
string  // Gemini's analysis response
```

**Examples:**
```javascript
// Code review
await analyze_code(
  "Review this function for performance",
  "/Users/rexmacmini/Project/index.js"
)

// Architecture analysis
await analyze_code(
  "Explain the three-tier architecture of OpenClaw"
)

// Debugging help
await analyze_code(
  "Why would this produce a race condition?",
  "/path/to/async-code.ts"
)
```

### dev_task(task, project?)
Dispatch development work to Claude.

**Parameters:**
- `task` (string): Development task description
- `project` (string, optional): Project directory name

**Returns:**
```javascript
{
  sessionId: string,  // Session identifier
  message: string     // User-friendly message
}
```

**Examples:**
```javascript
// Bug fix
await dev_task(
  "Fix the type error in handleSubmit function",
  "personal-ai-assistant"
)

// New feature
await dev_task(
  "Add dark mode toggle to settings page",
  "rex-bot"
)

// Refactoring
await dev_task(
  "Refactor database queries to use connection pooling",
  "taiwan-stock-mvp"
)
```

## 🔌 Integration Points

### 1. Direct Function Import
```javascript
import { createRexTools, systemPrompt } from './src/tools.js'

const tools = createRexTools()
tools.forEach(tool => {
  // Register each tool in your system
})
```

### 2. As OpenClaw Plugin
```javascript
// index.js exports as plugin
export default {
  getAgentTools() { return createRexTools() },
  getSystemPrompt() { return systemPrompt },
  async register(api) { ... }
}
```

### 3. Environment Variables
```bash
# Required
GEMINI_API_KEY=your-api-key
SESSION_BRIDGE_URL=http://localhost:7788

# Auto-detected
HOME=/Users/rexmacmini
# ~/.agentd-token is read from here

# Optional
AGENTD_URL=http://127.0.0.1:7777
OLLAMA_URL=http://localhost:11434
```

## 🧪 Testing

### Test /shell/exec endpoint
```bash
TOKEN=$(cat ~/.agentd-token)
curl -X POST http://127.0.0.1:7777/shell/exec \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "echo Hello from Mac mini"}'

# Expected response:
# {"ok":true,"output":"Hello from Mac mini"}
```

### Test Gemini integration
```bash
# Verify API key
curl https://generativelanguage.googleapis.com/v1/models \
  -H "x-goog-api-key: $GEMINI_API_KEY" | jq '.models | length'
```

### Test Session Bridge
```bash
curl http://localhost:7788/health
# Expected: 200 OK
```

## 🛡️ Security Considerations

### Blacklist Protection
Command blacklist prevents:
- Destructive filesystem operations (rm -rf /, mkfs)
- System shutdown (shutdown, reboot, launchctl bootout)
- Pipe-based code injection (| sh, | bash)
- Privilege escalation patterns

See `mac-agentd.cjs` lines 274-285 for complete list.

### Token Security
- Tokens stored in `~/.agentd-token` (not in git)
- Authorization: Bearer scheme for all mac-agentd calls
- Token rotation recommended monthly
- Rate limited: 100 requests per 5 minutes

### API Rate Limits
- Gemini: 1000 requests/day (OAuth free tier)
- Session Bridge: Per-session limits apply
- mac-agentd: 100 req/5min per token

## 📋 Troubleshooting

### /shell/exec returns "unknown endpoint"
```bash
# Check if mac-agentd is running
pgrep -f mac-agentd.cjs

# Restart if needed
pkill -f mac-agentd.cjs
cd /Users/rexmacmini/openclaw
nohup node mac-agentd.cjs > ~/.mac-agentd.log 2>&1 &
```

### Gemini API errors
```bash
# Verify API key
echo $GEMINI_API_KEY

# Check quota
curl https://generativelanguage.googleapis.com/v1/models \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  | jq '.models[0]'
```

### Session Bridge timeout
```bash
# Check Session Bridge health
curl http://localhost:7788/health

# View logs
docker logs session-bridge --tail 50
```

## 🚢 Deployment

### Docker Compose (if applicable)
```yaml
services:
  openclaw-agent:
    environment:
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      SESSION_BRIDGE_URL: http://session-bridge:7788
    volumes:
      - /Users/rexmacmini/openclaw/extensions:/app/extensions
```

### Manual Setup
```bash
# 1. Start mac-agentd
cd /Users/rexmacmini/openclaw
node mac-agentd.cjs &

# 2. Ensure Session Bridge is running
curl http://localhost:7788/health

# 3. Load rex-agent into openclaw (method depends on openclaw version)
# - Option A: OpenClaw auto-discovers from extensions/
# - Option B: Import in agent configuration
# - Option C: Manually register tools in code
```

## 📊 Performance Considerations

- **run_command**: <1s for typical commands, 30s timeout
- **analyze_code**: 2-5s for Gemini (depends on input size)
- **dev_task**: Asynchronous, no timeout (Claude Session owns it)
- **Concurrency**: Safe for parallel tool calls (stateless design)

## 🔄 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-05 | Initial integration with OpenClaw |

## 📝 Contributing

To extend rex-agent:

1. Add new tool to `TOOLS` array in `src/tools.js`
2. Implement handler in `executeTool()` function
3. Update system prompt documentation
4. Test with all three API paths
5. Update CHANGELOG

## 📄 License

Same as OpenClaw project

## 🤝 Support

For issues or questions:
1. Check troubleshooting section above
2. Review `openclaw-integration.md` for detailed setup
3. Check `~/.mac-agentd.log` and docker logs
4. Refer to rex-agent system prompt for tool examples

