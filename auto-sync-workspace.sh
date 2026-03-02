#!/bin/bash
# OpenClaw workspace auto-sync to GitHub
# Runs via cron every 15 minutes

WORKSPACE="/Users/rexmacmini/openclaw/config/workspace"
LOG="/Users/rexmacmini/openclaw/sync.log"

cd "$WORKSPACE" || exit 1

# Check if there are changes
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    exit 0  # No changes, skip
fi

# Commit and push
git add -A
git commit -m "auto-sync: $(date '+%Y-%m-%d %H:%M')" --no-gpg-sign 2>/dev/null
git push origin main 2>>"$LOG"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] synced" >> "$LOG"
