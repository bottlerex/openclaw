# TOOLS.md - Code Review Agent

## SSH Access

- **Host**: host.docker.internal
- **User**: rexmacmini
- **Key**: /home/node/.ssh/id_ed25519

**Note**: You are a code-review agent. You can READ code but CANNOT modify files or run destructive commands.

## Bridge Scripts

### Read project code

```bash
bash /home/node/.openclaw/scripts/host-exec.sh "cat ~/openclaw/scripts/ws-gateway-client.mjs"
bash /home/node/.openclaw/scripts/host-exec.sh "git -C ~/openclaw diff HEAD~1"
bash /home/node/.openclaw/scripts/host-exec.sh "git -C ~/openclaw log --oneline -10"
```

### Check gateway status

```bash
bash /home/node/.openclaw/scripts/oc-bridge.sh sessions.list
bash /home/node/.openclaw/scripts/oc-bridge.sh channels.status
```

## Available Projects (host ~/Project/active_projects/)

- taiwan-stock-mvp — Stock analysis platform
- personal-ai-assistant — AI assistant
- openclaw — This system's source
