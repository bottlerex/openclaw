#!/usr/bin/env bash
# Execute a command on the Mac mini host via HTTP (execd) through squid proxy
# With SSH fallback for transition period
# v2: Added command whitelist for safety
set -euo pipefail

HOST_ADDR="${OC_BRIDGE_HOST:-host.docker.internal}"
EXECD_URL="http://${HOST_ADDR}:19800/exec"
EXECD_TOKEN_FILE="/home/node/.openclaw/execd-token.txt"
PROXY_URL="${HTTP_PROXY:-http://192.168.107.4:3128}"
AUDIT_LOG="/home/node/.openclaw/logs/exec-audit.jsonl"

if [ $# -eq 0 ]; then
  echo "Usage: host-exec.sh <command>"
  exit 1
fi

mkdir -p "$(dirname "$AUDIT_LOG")" 2>/dev/null || true

CMD="$*"
SOURCE_AGENT="${OC_AGENT_NAME:-unknown}"

# ── Command whitelist (v2) ──
# Extract the first word/command from the input
FIRST_CMD=$(echo "$CMD" | sed 's/^[[:space:]]*//' | awk '{print $1}')
# Strip path prefix to get base command name
BASE_CMD=$(basename "$FIRST_CMD")

# Allowed commands (read-only + safe operations)
ALLOWED_CMDS="gh gog git docker ls cat grep find head tail wc sort awk sed cut tr diff uptime hostname whoami uname date pwd df du stat id env ps echo curl ssh node npm npx python3 pip basename dirname realpath mktemp timeout tee open osascript nohup"

# Allowed scripts (full paths on host)
ALLOWED_SCRIPTS="gog-auth-bridge.sh disk-info.sh git-wrapper.sh system-stats.sh process-manager.sh network-check.sh ollama-manager.sh ollama-auto-restart.sh taiwan-stock-status.sh taiwan-stock-backup.sh taiwan-stock-eval.sh log-checker.sh notify.sh fetch-statements.sh"

# Check if command is allowed
CMD_ALLOWED=false

# Check base commands
for allowed in $ALLOWED_CMDS; do
  if [ "$BASE_CMD" = "$allowed" ]; then
    CMD_ALLOWED=true
    break
  fi
done

# Check allowed scripts
if [ "$CMD_ALLOWED" = "false" ]; then
  for script in $ALLOWED_SCRIPTS; do
    if echo "$CMD" | grep -q "$script"; then
      CMD_ALLOWED=true
      break
    fi
  done
fi

# Check if it's a cd + allowed command combo
if [ "$CMD_ALLOWED" = "false" ] && echo "$CMD" | grep -qE '^cd .+ && '; then
  AFTER_CD=$(echo "$CMD" | sed 's/^cd [^ ]* && //')
  AFTER_CMD=$(echo "$AFTER_CD" | awk '{print $1}')
  AFTER_BASE=$(basename "$AFTER_CMD")
  for allowed in $ALLOWED_CMDS; do
    if [ "$AFTER_BASE" = "$allowed" ]; then
      CMD_ALLOWED=true
      break
    fi
  done
fi

# Block dangerous patterns regardless of command
if echo "$CMD" | grep -qiE 'rm -rf|rm -r|rmdir|chmod|chown|mkfs|dd if=|> /dev|curl.*\| *bash|wget.*\| *bash'; then
  CMD_ALLOWED=false
fi

if [ "$CMD_ALLOWED" = "false" ]; then
  echo "ERROR: Command not in whitelist: $BASE_CMD" >&2
  echo "Allowed: $ALLOWED_CMDS" >&2
  echo "Use dev_task for file modifications." >&2
  # Audit the blocked attempt
  echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"command\":\"blocked\",\"raw\":$(printf '%s' "$CMD" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo "\"$CMD\""),\"source_agent\":\"$SOURCE_AGENT\"}" >> "$AUDIT_LOG" 2>/dev/null || true
  exit 1
fi

# Block dangerous git subcommands
if [ "$BASE_CMD" = "git" ] || echo "$CMD" | grep -qE '(^|&& *)git '; then
  # Extract git subcommand, skipping flags like -C <path>
  GIT_SUBCMD=$(echo "$CMD" | grep -oE '(^|&& *)git( -[A-Za-z]+ [^ ]+)* [a-z][a-z-]*' | tail -1 | awk '{print $NF}')
  SAFE_GIT="status log diff show fetch pull branch stash tag remote rev-parse rev-list shortlog describe name-rev ls-files ls-tree cat-file blame annotate reflog count-objects fsck"
  GIT_SAFE=false
  for sg in $SAFE_GIT; do
    if [ "$GIT_SUBCMD" = "$sg" ]; then
      GIT_SAFE=true
      break
    fi
  done
  if [ "$GIT_SAFE" = "false" ] && [ -n "$GIT_SUBCMD" ]; then
    echo "ERROR: git $GIT_SUBCMD not in safe subcommands" >&2
    echo "Allowed: $SAFE_GIT" >&2
    echo "Use dev_task for git push/reset/clean/checkout." >&2
    echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"command\":\"blocked-git\",\"raw\":\"$CMD\",\"source_agent\":\"$SOURCE_AGENT\"}" >> "$AUDIT_LOG" 2>/dev/null || true
    exit 1
  fi
fi

# Try execd (HTTP via proxy)
if [ -f "$EXECD_TOKEN_FILE" ]; then
  EXECD_TOKEN=$(cat "$EXECD_TOKEN_FILE")
  CMD_JSON=$(printf '%s' "$CMD" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo "\"$CMD\"")

  RESULT=$(curl -s --max-time 60 \
    --proxy "$PROXY_URL" \
    -H "Authorization: Bearer $EXECD_TOKEN" \
    -H "Content-Type: application/json" \
    -w "\n%{http_code}" \
    -d "{\"command\":$CMD_JSON,\"agent\":\"$SOURCE_AGENT\",\"timeout\":30000}" \
    "$EXECD_URL" 2>/dev/null) || true

  if [ -n "$RESULT" ]; then
    HTTP_CODE=$(echo "$RESULT" | tail -1)
    BODY=$(echo "$RESULT" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
      OUTPUT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stdout',''), end='')" 2>/dev/null || echo "$BODY")
      STDERR=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('stderr',''); print(s, end='') if s else None" 2>/dev/null)
      EXIT_CODE=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('exitCode',1))" 2>/dev/null || echo 1)
      [ -n "$STDERR" ] && echo "$STDERR" >&2
      echo "$OUTPUT"
      exit "$EXIT_CODE"
    elif [ "$HTTP_CODE" = "403" ]; then
      ERROR=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','denied'))" 2>/dev/null || echo "denied")
      echo "ERROR: $ERROR" >&2
      exit 1
    fi
  fi
fi

# Fallback: SSH (transition period)
HOST_USER="${OC_BRIDGE_USER:-rexmacmini}"
CMD_JSON=$(printf "%s" "$CMD" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo "\"$CMD\"")
ARGS_JSON=$(printf '%s\n' "$@" | python3 -c "import sys,json; print(json.dumps([l.rstrip() for l in sys.stdin]))" 2>/dev/null || echo '[]')

OUTPUT=$(ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no "${HOST_USER}@${HOST_ADDR}" "$@" 2>&1)
EXIT_CODE=$?

echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"command\":\"ssh-fallback\",\"args\":$ARGS_JSON,\"user\":\"$(whoami)\",\"source_agent\":\"$SOURCE_AGENT\",\"status\":\"$([ $EXIT_CODE -eq 0 ] && echo success || echo failure)\",\"exit_code\":$EXIT_CODE,\"executor\":\"host\"}" >> "$AUDIT_LOG" 2>/dev/null || true

echo "$OUTPUT"
exit $EXIT_CODE
