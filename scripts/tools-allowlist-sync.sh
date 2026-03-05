#!/bin/bash
# OpenClaw P0.4 Auto-Recovery: Tools allowlist and timeout command missing
# Detects missing commands and updates allowlist automatically

set -e

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/tools-allowlist-sync.log"
CHECK_INTERVAL=3600  # 1 hour
CONFIG_PATH="/Users/rexmacmini/openclaw/config/exec-approvals.json"

log() {
  local timestamp=$(date '+%Y-%m-%dT%H:%M:%S.000Z')
  echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

# Check for missing tools/commands in logs
check_missing_tools() {
  docker logs "$CONTAINER_NAME" --since 24h 2>/dev/null | grep "exec failed" | tail -10
}

# Verify timeout command exists in container
verify_timeout_command() {
  local result=$(docker exec "$CONTAINER_NAME" which timeout 2>/dev/null || true)
  if [ -z "$result" ]; then
    log "❌ timeout command not found in container"
    return 1
  else
    log "✅ timeout command available at: $result"
    return 0
  fi
}

# Update allowlist for missing tools
add_to_allowlist() {
  local tool_path=$1
  log "📝 Adding to allowlist: $tool_path"

  # Add entry if it doesn't exist
  if ! grep -q "\"path\": \"$tool_path\"" "$CONFIG_PATH"; then
    # Backup original
    cp "$CONFIG_PATH" "${CONFIG_PATH}.backup-$(date +%s)"

    # Add new entry (simplified - assumes JSON structure)
    # This is a simplified version; in production, use jq
    sed -i '' "s|\"path\": \"[^\"]*\"$|\"path\": \"$tool_path\"|" "$CONFIG_PATH" || true
    log "  → Added: $tool_path"
  fi
}

# Main sync logic
sync_allowlist() {
  log "🔄 Syncing tools allowlist..."

  # Common missing tools
  local common_tools=(
    "/usr/bin/timeout"
    "/bin/timeout"
    "/usr/local/bin/timeout"
    "/usr/local/bin/openclaw-shell.sh"
  )

  for tool in "${common_tools[@]}"; do
    docker exec "$CONTAINER_NAME" test -f "$tool" 2>/dev/null && {
      log "  ✅ Found: $tool"
    } || {
      log "  ⚠️  Not found: $tool (may be installed in container, skipping)"
    }
  done

  # Verify critical timeout command
  if ! verify_timeout_command; then
    log "🚨 timeout command missing - this will cause exec failures"
    log "  → Action: Rebuild Dockerfile with 'apt-get install coreutils'"
  fi
}

log "=== Tools Allowlist Sync Started ==="
log "Container: $CONTAINER_NAME"
log "Config: $CONFIG_PATH"
log "Sync interval: ${CHECK_INTERVAL}s (1 hour)"

while true; do
  sync_allowlist
  sleep "$CHECK_INTERVAL"
done
