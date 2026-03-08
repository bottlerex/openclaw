#!/usr/bin/env bash
# OpenClaw Exec Audit Wrapper
# Records all command executions to exec-audit.jsonl with full schema
# Usage: exec-wrapper.sh <command> [args...]
set -euo pipefail

AUDIT_LOG="/home/node/.openclaw/logs/exec-audit.jsonl"
ALLOWLIST_FILE="/home/node/.openclaw/exec-approvals.json"

if [ $# -eq 0 ]; then
  echo "Usage: exec-wrapper.sh <command> [args...]"
  exit 1
fi

mkdir -p "$(dirname "$AUDIT_LOG")" 2>/dev/null || true

COMMAND="$1"
shift
ARGS_JSON=$(printf '%s\n' "$@" | python3 -c "import sys,json; print(json.dumps([l.rstrip() for l in sys.stdin]))" 2>/dev/null || echo '[]')
WORKING_DIR="$(pwd)"
CURRENT_USER="$(whoami)"
SOURCE_AGENT="${OC_AGENT_NAME:-unknown}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Check allowlist
STATUS="success"
BLOCKED="false"
if [ -f "$ALLOWLIST_FILE" ]; then
  CMD_PATH=$(command -v "$COMMAND" 2>/dev/null || echo "$COMMAND")
  if ! python3 -c "
import json, sys, re
with open('$ALLOWLIST_FILE') as f:
    data = json.load(f)
agents = data.get('agents', {})
path = '$CMD_PATH'
for agent_name, agent in agents.items():
    for entry in agent.get('allowlist', []):
        pattern = entry.get('pattern', '')
        if pattern == path or path.startswith(pattern.rstrip('*')):
            sys.exit(0)
        try:
            if re.match(pattern, path):
                sys.exit(0)
        except: pass
sys.exit(1)
" 2>/dev/null; then
    BLOCKED="true"
    STATUS="blocked"
  fi
fi

# Log function
log_entry() {
  local exit_code="${1:-0}"
  local duration_ms="${2:-0}"
  local status="${3:-success}"

  CMD_JSON=$(printf "%s" "$COMMAND" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo "\"$COMMAND\"")

  echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"command\":$CMD_JSON,\"args\":$ARGS_JSON,\"working_dir\":\"$WORKING_DIR\",\"user\":\"$CURRENT_USER\",\"source_agent\":\"$SOURCE_AGENT\",\"status\":\"$status\",\"exit_code\":$exit_code,\"duration_ms\":$duration_ms}" >> "$AUDIT_LOG" 2>/dev/null || true
}

# If blocked, log and exit
if [ "$BLOCKED" = "true" ]; then
  log_entry 1 0 "blocked"
  echo "BLOCKED: $COMMAND is not in the allowlist" >&2
  exit 1
fi

# Execute with timing
START_MS=$(python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null || date +%s)
"$COMMAND" "$@"
EXIT_CODE=$?
END_MS=$(python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null || date +%s)

DURATION_MS=$((END_MS - START_MS))

if [ "$EXIT_CODE" -ne 0 ]; then
  STATUS="failure"
fi

log_entry "$EXIT_CODE" "$DURATION_MS" "$STATUS"

exit $EXIT_CODE
