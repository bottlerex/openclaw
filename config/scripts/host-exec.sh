#!/usr/bin/env bash
# Execute a command on the Mac mini host via HTTP (execd) through squid proxy
# With SSH fallback for transition period
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
