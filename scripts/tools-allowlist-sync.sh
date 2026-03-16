#!/bin/bash
# OpenClaw P0.4: Tools Allowlist Auto-Sync
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# Runs daily to sync allowed commands from logs to config

set -e

CONTAINER_NAME="openclaw-agent"
ALLOWLIST_FILE="/tmp/openclaw-allowlist.json"
LOG_FILE="/tmp/tools-allowlist-sync.log"
BACKUP_DIR="/tmp/allowlist-backups"

log() {
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$timestamp] $1" >> "$LOG_FILE"
}

# Initialize
mkdir -p "$BACKUP_DIR"

log "🚀 Tools Allowlist Sync started"

# Step 1: Extract recently used commands from container logs (last 24 hours)
log "📋 Extracting used commands from logs..."

RECENT_COMMANDS=$(docker logs "$CONTAINER_NAME" --since 24h 2>/dev/null | \
  grep -oE "(exec|bash|sh|python|node|npm|docker|curl|git|jq)\s+[^\s]+" | \
  awk '{print $1}' | \
  sort | uniq -c | sort -rn | \
  awk '{print $2}' || echo "")

if [ -z "$RECENT_COMMANDS" ]; then
  log "⚠️  No commands found in recent logs"
  exit 0
fi

log "✅ Found commands: $(echo "$RECENT_COMMANDS" | wc -l)"

# Step 2: Build new allowlist
log "🔨 Building new allowlist..."

NEW_ALLOWLIST='{
  "version": "1.0",
  "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")'",
  "source": "auto-sync from container logs",
  "rules": ['

# Add commands
FIRST=true
while read -r cmd; do
  if [ -n "$cmd" ]; then
    if [ "$FIRST" = true ]; then
      FIRST=false
    else
      NEW_ALLOWLIST+=","
    fi
    
    NEW_ALLOWLIST+=$'\n    '"{"
    NEW_ALLOWLIST+=$'\n      "path": "'"$cmd"'",'
    NEW_ALLOWLIST+=$'\n      "allowed": true,'
    NEW_ALLOWLIST+=$'\n      "requireApproval": false,'
    NEW_ALLOWLIST+=$'\n      "detectedAt": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")'"'
    NEW_ALLOWLIST+=$'\n    '"}"
  fi
done <<< "$RECENT_COMMANDS"

NEW_ALLOWLIST+=$'\n  ]\n}'

# Step 3: Backup existing allowlist
if [ -f "$ALLOWLIST_FILE" ]; then
  BACKUP_FILE="$BACKUP_DIR/allowlist-$(date -u +%Y%m%d-%H%M%S 2>/dev/null || date +%Y%m%d-%H%M%S).json.bak"
  cp "$ALLOWLIST_FILE" "$BACKUP_FILE"
  log "💾 Backed up old allowlist to $BACKUP_FILE"
fi

# Step 4: Write new allowlist
echo "$NEW_ALLOWLIST" > "$ALLOWLIST_FILE"
log "✅ New allowlist written: $ALLOWLIST_FILE ($(wc -l < "$ALLOWLIST_FILE") lines)"

# Step 5: Validate JSON
if ! jq . "$ALLOWLIST_FILE" > /dev/null 2>&1; then
  log "❌ New allowlist JSON validation failed"
  # Restore from backup if available
  if [ -f "$BACKUP_FILE" ]; then
    cp "$BACKUP_FILE" "$ALLOWLIST_FILE"
    log "🔄 Restored from backup"
  fi
  exit 1
fi

log "✅ JSON validation passed"

# Step 6: Report
RULE_COUNT=$(jq '.rules | length' "$ALLOWLIST_FILE")
log "📊 Allowlist updated: $RULE_COUNT rules"

# Step 7: Cleanup old backups (keep only 7 days)
find "$BACKUP_DIR" -name "allowlist-*.json.bak" -mtime +7 -delete
log "🧹 Cleaned up old backups (>7 days)"

log "✅ Sync completed successfully"

# Send Telegram notification
curl -s -X POST https://localhost:18789/telegram/send \
  -H "Content-Type: application/json" \
  -d "{\"to\": \"150944774\", \"text\": \"✅ P0.4: Tools allowlist synced\n• Rules: $RULE_COUNT\n• Time: $(date)\"}" 2>/dev/null || true

exit 0
