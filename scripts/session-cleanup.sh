#!/bin/bash
set -euo pipefail

DOCKER="$HOME/.orbstack/bin/docker"
CONTAINER="openclaw-agent"
SESSION_DIR="/home/node/.openclaw/agents/main/sessions"
MAX_SIZE_KB=50
KEEP_LINES=50
LOG="$HOME/openclaw/logs/session-cleanup.log"
TS=$(date '+%Y-%m-%dT%H:%M:%S')

# Find all session .jsonl files
files=$($DOCKER exec $CONTAINER find $SESSION_DIR -name '*.jsonl' 2>/dev/null || true)
[ -z "$files" ] && exit 0

cleaned=0
while IFS= read -r f; do
    [ -z "$f" ] && continue
    # Get size in bytes inside container
    size=$($DOCKER exec $CONTAINER sh -c "wc -c < '$f'" 2>/dev/null || echo 0)
    size=${size// /}
    max_bytes=$((MAX_SIZE_KB * 1024))

    if [ "$size" -gt "$max_bytes" ]; then
        old_kb=$((size / 1024))
        fname=$(basename "$f")
        # Truncate: keep last N lines, write to temp, then replace
        $DOCKER exec $CONTAINER sh -c "tail -n $KEEP_LINES '$f' > '$f.tmp' && mv '$f.tmp' '$f'"
        new_size=$($DOCKER exec $CONTAINER sh -c "wc -c < '$f'" 2>/dev/null || echo 0)
        new_size=${new_size// /}
        new_kb=$((new_size / 1024))
        echo "[$TS] session-cleanup: $fname ${old_kb}KB -> ${new_kb}KB (kept $KEEP_LINES lines)" >> "$LOG"
        cleaned=$((cleaned + 1))
    fi
done <<< "$files"

[ "$cleaned" -eq 0 ] || echo "[$TS] session-cleanup: cleaned $cleaned file(s)" >> "$LOG"
