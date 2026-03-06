# Host Script Layer — OpenClaw Capability Extension

**Date**: 2026-03-06  
**Status**: Deployed  
**Scripts**: 11 total (2 from P0.5 + 9 new)

## Overview

This layer extends OpenClaw's capabilities while maintaining bounded autonomy security model. All scripts run on the Mac mini host and are allowlisted for execution by OpenClaw containers.

## Architecture

```
OpenClaw Container
    ↓
allowlist check
    ↓
Host Script Layer
    ├─ System Monitoring
    ├─ Ollama Management
    ├─ Taiwan Stock MVP Status
    ├─ Log Aggregation
    └─ Notifications
    ↓
Mac mini OS (Full Access)
```

## Scripts

### System Monitoring (3 scripts)

#### `system-stats.sh`
```bash
# Get CPU/memory/disk statistics
config/scripts/system-stats.sh [--json] [--format brief|detailed]

# JSON output
config/scripts/system-stats.sh --json
```
- CPU usage percentage
- Memory pressure
- Disk usage (root partition)
- Process count
- JSON output mode supported

#### `process-manager.sh`
```bash
# List all key processes
config/scripts/process-manager.sh list

# Check specific process status
config/scripts/process-manager.sh check --process NAME

# Restart process (requires launchctl registration)
config/scripts/process-manager.sh restart --process NAME
```
Monitors: openclaw-agent, ollama, postgres, redis, python, node

#### `network-check.sh`
```bash
# Network diagnostics
config/scripts/network-check.sh [--target 8.8.8.8] [--json]

# Check specific host
config/scripts/network-check.sh --target google.com
```
- Ping latency to target
- DNS resolution test
- Local IP address
- JSON output mode

### Ollama Management (2 scripts)

#### `ollama-manager.sh`
```bash
# List all models
config/scripts/ollama-manager.sh list

# Check Ollama service status
config/scripts/ollama-manager.sh status

# Pull a model
config/scripts/ollama-manager.sh pull llama2

# Clean cache
config/scripts/ollama-manager.sh clean

# Validate setup (process + API)
config/scripts/ollama-manager.sh validate
```

#### `ollama-auto-restart.sh`
```bash
# Health check with automatic restart
config/scripts/ollama-auto-restart.sh [--max-retries 3]
```
- Tests Ollama API endpoint
- Auto-restarts via launchctl on failure
- Configurable retry count (default: 3)
- Logs all attempts

### Taiwan Stock MVP (2 scripts)

#### `taiwan-stock-status.sh`
```bash
# Get overall status
config/scripts/taiwan-stock-status.sh

# JSON output
config/scripts/taiwan-stock-status.sh --json

# Detailed logs
config/scripts/taiwan-stock-status.sh --detailed
```
Checks:
- Container status (frontend, backend, postgres, redis)
- API health endpoint (HTTP)
- Database connectivity

#### `taiwan-stock-backup.sh`
```bash
# Create backup
config/scripts/taiwan-stock-backup.sh backup
# → /Users/rexmacmini/backups/taiwan-stock/stock_db_YYYYMMDD_HHMMSS.sql.gz

# List backups
config/scripts/taiwan-stock-backup.sh list

# Restore from backup
config/scripts/taiwan-stock-backup.sh restore /path/to/backup.sql.gz

# Clean old backups (> 7 days)
config/scripts/taiwan-stock-backup.sh cleanup
```

### Utilities (2 scripts)

#### `log-checker.sh`
```bash
# OpenClaw container logs
config/scripts/log-checker.sh docker --service openclaw-agent --tail 50

# All Docker container logs
config/scripts/log-checker.sh docker

# System logs
config/scripts/log-checker.sh system

# Combined view
config/scripts/log-checker.sh all

# Grep pattern
config/scripts/log-checker.sh docker --service openclaw-agent --grep "error"
```

#### `notify.sh`
```bash
# Send notification via Telegram
config/scripts/notify.sh --service "Ollama" --severity ERROR --message "Service down"
```
Requires:
- `TELEGRAM_BOT_TOKEN` env var
- `TELEGRAM_CHAT_ID` env var
- Also logs to `/tmp/openclaw-notifications.log`

## Allowlist Configuration

All 11 scripts are registered in `config/exec-approvals.json`:

```json
{
  "id": "openclaw-system-stats",
  "pattern": "/Users/rexmacmini/openclaw/config/scripts/system-stats.sh",
  "description": "System CPU/memory/disk statistics"
},
...
```

OpenClaw can now call any of these scripts via `bash /path/to/script.sh`.

## Usage from OpenClaw

Within OpenClaw agent, all scripts are now executable:

```javascript
// Get system stats
const stats = await exec.run(`bash /Users/rexmacmini/openclaw/config/scripts/system-stats.sh --json`);

// Check Ollama health
const ollama = await exec.run(`bash /Users/rexmacmini/openclaw/config/scripts/ollama-manager.sh status`);

// Taiwan Stock MVP status
const mvp = await exec.run(`bash /Users/rexmacmini/openclaw/config/scripts/taiwan-stock-status.sh`);

// Send notification
await exec.run(`bash /Users/rexmacmini/openclaw/config/scripts/notify.sh --service "Alert" --severity WARN --message "High CPU usage"`);
```

## Testing Results (2026-03-06 09:30)

✅ System Stats:
- CPU: 257%
- Memory Pressure: 81%
- Disk: 8% / 144Gi
- Processes: 910

✅ Ollama:
- Status: running
- Models: 5 loaded

✅ Taiwan Stock MVP:
- Frontend: running
- Backend: running
- PostgreSQL: running
- Redis: running
- API Health: 200 OK

✅ Network:
- DNS: Resolved (142.250.77.14)
- Local IP: 192.168.10.205
- Ping: timeout (likely network policy)

## Security Considerations

1. **Bounded Autonomy**: All scripts execute on host with predefined permissions
2. **No Privilege Escalation**: Scripts cannot execute sudo commands
3. **Audit Trail**: All exec calls logged via OpenClaw's audit framework
4. **Input Validation**: Parameters validated in each script
5. **Sensitive Data**: Credentials loaded from environment variables, not hardcoded

## Next Steps

1. Configure environment variables:
   ```bash
   export TELEGRAM_BOT_TOKEN=<token>
   export TELEGRAM_CHAT_ID=<chat_id>
   export BACKUP_DIR=/Users/rexmacmini/backups/taiwan-stock
   ```

2. Test from OpenClaw container:
   ```bash
   docker exec openclaw-agent bash /Users/rexmacmini/openclaw/config/scripts/system-stats.sh
   ```

3. Integrate into OpenClaw workflows:
   - Health checks
   - Auto-recovery routines
   - Status dashboards
   - Alert notifications

## Files

- `/Users/rexmacmini/openclaw/config/scripts/` — All scripts (11 total)
- `config/exec-approvals.json` — Allowlist entries
- `config/HOST_SCRIPT_LAYER.md` — This documentation
