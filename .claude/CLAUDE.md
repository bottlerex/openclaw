# OpenClaw

## Architecture (5 Layers)

1. **Gateway** — WebSocket control plane (ws://127.0.0.1:18789). Session, config, cron, presence.
2. **Channels** — 13+ platform adapters (WhatsApp, Telegram, Slack, Discord, etc).
3. **Agent Runtime** — Pi agent RPC mode. LLM routing, tool calling, model failover.
4. **Apps/Nodes** — macOS/iOS/Android endpoints. Voice, camera, screen, local exec.
5. **Tools** — Browser (CDP), Canvas (A2UI), Nodes, Cron/Webhooks, Skills.

## Key Paths

- `src/` — core TS (gateway/, routing/, security/, monitoring/, logger.ts)
- `config/openclaw.json` — main config
- `config/exec-approvals.json` — exec permission allowlist
- `config/credentials/` — secrets (git-ignored)
- `config/cron/jobs.json` — cron registration
- `config/guardian.sh` — watchdog script
- `docker-compose.yml` / `.env` — container config
- `.state` — local architecture snapshot

## Build & Deploy

```bash
docker compose down && docker compose up -d --build   # rebuild
docker restart openclaw-agent                          # agent-only
docker compose pull && docker compose up -d            # pull latest
docker logs -f openclaw-agent --tail 100               # logs
```

## Health Checks

```bash
docker exec openclaw-agent curl -s http://localhost:18789/health
docker ps --filter name=openclaw --format "{{.Names}} {{.Status}}"
```

## Critical Rules — Bounded Autonomy

Every change MUST preserve: agent autonomy within bounds, runaway guard, guardian watchdog, multi-channel operability.

### Pre-Change Checklist (Mandatory)

1. Read `.state` + `src/` + `git log -30` + `docker logs openclaw-agent`
2. Verify container health before touching anything
3. Commit format: `feat(scope): [change] [affected: Module1 + Module2]`
4. Run full test suite post-change
5. Monitor `docker logs` for 24h post-change
6. No `git push --force`, no `git reset --hard`, no deleting merged branches

### 4-Layer Exec Permission (any deny = blocked)

1. `gateway.nodes.allowCommands` — whitelist (most common deny cause)
2. `tools.exec.security` — "deny" | "allowlist" | "full"
3. Extension allowlist — plugins without allowlist = rejected
4. Cron job registration — `config/cron/jobs.json`

## Known Issues

- **Telegram 409**: multiple bot instances polling simultaneously
- **WebChat 1006**: WS disconnect from missing heartbeat or memory leak
- **exec denied**: allowlist miss in gateway config or missing timeout
- **Health-monitor stuck**: restarts every 30min without proper backoff

## Recovery

```bash
docker compose down && docker compose up -d            # full restart
docker restart openclaw-agent                          # agent only
docker restart openclaw-https-proxy                    # proxy only
docker exec openclaw-agent ps aux | grep node          # check stuck
docker exec openclaw-agent rm -rf /var/tmp/openclaw-compile-cache  # clear cache
```
