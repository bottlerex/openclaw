#!/usr/bin/env bash
# Rotate dev-tasks.jsonl — keep last 100 entries, archive old ones
set -euo pipefail

TASKS_FILE="$HOME/.openclaw/dev-tasks.jsonl"
ARCHIVE_DIR="$HOME/.openclaw/logs/archive"

[ -f "$TASKS_FILE" ] || exit 0

LINE_COUNT=$(wc -l < "$TASKS_FILE")
[ "$LINE_COUNT" -le 100 ] && exit 0

mkdir -p "$ARCHIVE_DIR"
ARCHIVE_FILE="$ARCHIVE_DIR/dev-tasks-$(date +%Y%m%d-%H%M%S).jsonl"

# Archive everything except last 100 lines
head -n -100 "$TASKS_FILE" > "$ARCHIVE_FILE"
tail -100 "$TASKS_FILE" > "${TASKS_FILE}.tmp"
mv "${TASKS_FILE}.tmp" "$TASKS_FILE"

echo "Rotated: archived $((LINE_COUNT - 100)) entries to $ARCHIVE_FILE"
