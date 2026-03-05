# OpenClaw + Rex-Agent Integration

This document describes the integration of rex-bot's capabilities into OpenClaw through the rex-agent extension.

## What is Rex-Agent?

Rex-Agent bridges OpenClaw with Mac mini tools and services:

```
OpenClaw Telegram
       ↓
   Main Agent
       ├─ run_command ──→ Docker, file ops, git, monitoring
       ├─ analyze_code ─→ Gemini 2.5 Flash (code review, explanation)
       └─ dev_task ────→ Claude Session Bridge (complex work)
       ↓
    Output → User Telegram
```

## Component Overview

### 1. mac-agentd (:7777)
Host process that safely executes commands:
- **Location**: `/Users/rexmacmini/openclaw/mac-agentd.cjs`
- **Runs as**: Host Node.js process (not in container)
- **Authentication**: Token-based (`~/.agentd-token`)
- **Safety**: 12-pattern blacklist, 100KB output limit
- **Routes**:
  - `/shell/exec` - NEW: Execute shell commands with protection
  - `/fs/read`, `/fs/write`, `/fs/list` - File operations
  - `/git/log`, `/git/status`, `/git/diff`, etc. - Git operations
  - `/docker/ps`, `/docker/restart`, `/docker/logs` - Container management
  - `/project/test` - Run tests (Python/Node.js)

### 2. rex-agent Extension
OpenClaw plugin providing tool integration:
- **Location**: `/Users/rexmacmini/openclaw/extensions/rex-agent/`
- **Files**:
  - `index.js` - Plugin entry point
  - `package.json` - Dependencies (Gemini SDK)
  - `openclaw.plugin.json` - Plugin metadata
  - `src/tools.js` - Tool implementation (848 lines)
- **Tools**:
  - `run_command()` - Shell execution via mac-agentd
  - `analyze_code()` - Gemini 2.5 Flash integration
  - `dev_task()` - Claude Session Bridge dispatch

### 3. System Integration Points
Where rex-agent is used:
- **Config**: `/Users/rexmacmini/openclaw/config/agents/main/`
- **System Prompt**: `rex-agent-system-prompt.md` (capabilities list)
- **Integration Guide**: `extensions/rex-agent/openclaw-integration.md` (setup)

## How It Works

### Command Execution Flow
```
User: "What Docker containers are running?"
  ↓
Agent: Detects question needs system info
  ↓
Agent calls: run_command("docker ps")
  ↓
mac-agentd validates command (checks blacklist)
  ↓
Execute: docker ps (in shell)
  ↓
Return output to agent
  ↓
Agent formats and sends to user
```

### Code Analysis Flow
```
User: "Explain this architecture"
  ↓
Agent calls: analyze_code("Explain this...", "/path/file.ts")
  ↓
Read file (first 10KB)
  ↓
Call Gemini 2.5 Flash with code + question
  ↓
Return analysis
  ↓
Agent sends response to user
```

### Development Task Flow
```
User: "Add error handling to function X"
  ↓
Agent calls: dev_task("Add error handling...", "project-name")
  ↓
Spawn Claude Session via Session Bridge
  ↓
Return Session ID and receipt to user
  ↓
Claude works asynchronously
  ↓
Results pushed back via Telegram when done
```

## Installation & Setup

### Prerequisites
```bash
# On Mac mini:
- OpenClaw running in Docker
- mac-agentd process (Node.js host process)
- Session Bridge running (:7788)
- GEMINI_API_KEY environment variable set
```

### Verify Installation
```bash
# 1. Check mac-agentd
pgrep -f mac-agentd.cjs && echo "✓" || echo "✗"

# 2. Check /shell/exec endpoint
TOKEN=$(cat ~/.agentd-token)
curl -X POST http://127.0.0.1:7777/shell/exec \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"date"}'

# 3. Check rex-agent files
ls -la /Users/rexmacmini/openclaw/extensions/rex-agent/

# 4. Check Gemini API
curl https://generativelanguage.googleapis.com/v1/models \
  -H "x-goog-api-key: $GEMINI_API_KEY"
```

### Enable in OpenClaw Agent

**Option A: Via System Prompt** (Recommended for immediate use)
```
Add to agent's system prompt:

你現在可以使用 Rex 工具：
1. run_command(cmd, cwd?) - 執行 Mac mini 命令
2. analyze_code(q, file?) - Gemini 代碼分析  
3. dev_task(task, proj?) - Claude 開發協助

範例：
- "看一下 Docker 狀態" → run_command("docker ps")
- "解釋這個架構" → analyze_code("解釋...", "file.ts")
- "幫我加入錯誤處理" → dev_task("Add error handling", "project")
```

**Option B: Via Plugin Loader** (if supported)
- OpenClaw auto-discovers extensions/rex-agent/
- Loads index.js and registers tools
- Requires openclaw plugin API support

**Option C: Via Custom Integration**
- Import `src/tools.js` into agent code
- Call `createRexTools()` to get tool definitions
- Register with your agent framework

## Usage Examples

### Docker Management
```
User: "Restart the openclaw container"
Agent: run_command("docker restart openclaw-agent")
Output: Container restarted message

User: "Show me the last 30 logs from openclaw"
Agent: run_command("docker logs openclaw-agent --tail 30")
Output: Log output
```

### Code Review
```
User: "Review this Python file for performance"
Agent: analyze_code(
  "Review for performance issues",
  "/Users/rexmacmini/Project/processor.py"
)
Output: Gemini analysis of performance
```

### Development Assistance
```
User: "Add authentication to the API endpoint"
Agent: dev_task(
  "Add JWT authentication to POST /api/users",
  "personal-ai-assistant"
)
Output: Session ID, Claude starts working on it
         Results delivered via Telegram later
```

## Security Model

### Command Blacklist
Blocked patterns (12 total):
- `rm -rf /`, `rm -rf ~` - Destructive file deletion
- `mkfs` - Filesystem destruction
- `dd if=/dev` - Disk overwrite
- `chmod -R 777 /` - Dangerous permissions
- `shutdown`, `reboot` - System control
- `launchctl bootout` - Service termination
- `| sh`, `| bash` - Pipe injection
- Fork bomb pattern

### Token Security
- Token in `~/.agentd-token` (not in version control)
- Bearer authentication for all requests
- Tokens validated before each command
- Token rotation recommended monthly

### API Rate Limits
- mac-agentd: 100 requests / 5 minutes
- Gemini: Free tier 1000 req/day (or your quota)
- Session Bridge: Per-session limits

### Output Safety
- Maximum 100KB per command execution
- Sensitive data can be redacted (configurable)
- Logs stored securely with access controls

## Troubleshooting

### Mac-agentd Issues
```
Problem: POST /shell/exec returns "unknown endpoint"
Solution:
  1. pkill -f mac-agentd.cjs
  2. cd /Users/rexmacmini/openclaw
  3. nohup node mac-agentd.cjs > ~/.mac-agentd.log 2>&1 &
  4. Verify: pgrep -f mac-agentd.cjs

Problem: Authorization failed
Solution:
  1. cat ~/.agentd-token  # Check it exists
  2. token must be ≥32 chars
  3. Verify Bearer header in request
```

### Gemini API Issues
```
Problem: Gemini returns API error
Solution:
  1. echo $GEMINI_API_KEY  # Verify it's set
  2. curl test: curl https://generativelanguage.googleapis.com/v1/models \
      -H "x-goog-api-key: $GEMINI_API_KEY"
  3. Check quota on https://aistudio.google.com
  4. Verify API is enabled in Google Cloud Console
```

### Session Bridge Issues
```
Problem: dev_task returns timeout error
Solution:
  1. curl http://localhost:7788/health
  2. docker ps | grep session-bridge  # Should be running
  3. Check cwd exists: ls /Users/rexmacmini/<project>
  4. Verify CLAUDE_API_KEY for Session Bridge
```

## Monitoring & Logs

### Mac-agentd Logs
```bash
tail -f ~/.mac-agentd.log
# Or via audit:
curl -H "Authorization: Bearer $TOKEN" \
     http://127.0.0.1:7777/audit-log
```

### OpenClaw Agent Logs
```bash
docker logs openclaw-agent --tail 100 -f
# Search for rex-agent:
docker logs openclaw-agent | grep -i rex
```

### Session Bridge Logs
```bash
docker logs session-bridge --tail 50 -f
```

## Performance Characteristics

| Operation | Latency | Timeout | Notes |
|-----------|---------|---------|-------|
| run_command | <1s | 30s | Most commands complete instantly |
| analyze_code | 2-5s | 10s | Depends on Gemini API latency |
| dev_task | <100ms | N/A | Async dispatch, no timeout |

## Future Enhancements

Potential improvements for rex-agent:

1. **Streaming Output**
   - Stream large command outputs instead of buffering
   - Real-time progress for long operations

2. **Advanced Blacklist**
   - Machine learning based pattern detection
   - Whitelisting for known-safe commands

3. **Caching**
   - Cache Gemini analysis results
   - Cache command outputs for repeated queries

4. **Metrics**
   - Track tool usage and performance
   - Alert on unusual patterns

5. **Multi-language**
   - Support other shell languages (Python, Ruby, etc.)
   - Structured output modes (JSON, CSV)

## Related Documentation

- `extensions/rex-agent/README.md` - Full tool API reference
- `extensions/rex-agent/openclaw-integration.md` - Integration details
- `config/agents/main/rex-agent-system-prompt.md` - Capabilities for agent
- `mac-agentd.cjs` - Implementation details (L266-297 /shell/exec)

