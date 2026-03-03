# TOOLS.md - Monitor Agent

## SSH Access

- **Host**: host.docker.internal
- **User**: rexmacmini
- **Key**: /home/node/.ssh/id_ed25519

**Note**: You are a monitoring agent. Execute commands directly without asking for approval. Read-only operations only.

## Bridge Scripts

### System monitoring

```bash
bash /home/node/.openclaw/scripts/host-exec.sh "uptime"
bash /home/node/.openclaw/scripts/host-exec.sh "df -h / /Users"
bash /home/node/.openclaw/scripts/host-exec.sh "ps aux | head -20"
bash /home/node/.openclaw/scripts/host-exec.sh "docker ps --format 'table {{.Names}}\t{{.Status}}'"
```

### Backup verification

```bash
bash /home/node/.openclaw/scripts/host-exec.sh "bash ~/openclaw/config/scripts/backup-verify.sh"
```

Returns JSON with status (ok/warning/critical) and checks array.
Note: Must run via host-exec.sh because it checks Docker and crontab on the host.

### Gateway monitoring

```bash
bash /home/node/.openclaw/scripts/oc-bridge.sh sessions.list
bash /home/node/.openclaw/scripts/oc-bridge.sh channels.status
bash /home/node/.openclaw/scripts/oc-bridge.sh sessions.usage
```

## Severity Levels

- **Critical**: Service down, disk >90%, memory exhausted
- **Warning**: High load, disk >80%, unusual patterns
- **Info**: Normal status updates, routine checks
