#!/usr/bin/env bash
# pipeline-cleanup.sh — 清理 14 天以上的管線檔案
# 用法: pipeline-cleanup.sh [days]
# crontab: 0 3 * * * /Users/rexmacmini/openclaw/scripts/pipeline-cleanup.sh
set -euo pipefail

PIPELINE_DIR="/Users/rexmacmini/openclaw/config/workspace/pipeline"
RETENTION_DAYS="${1:-14}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cleaned=0
for dir in intel drafts reviews; do
  target="${PIPELINE_DIR}/${dir}"
  [ -d "${target}" ] || continue
  while IFS= read -r -d '' file; do
    rm -f "${file}"
    cleaned=$((cleaned + 1))
    echo "[${TIMESTAMP}] removed: ${file}"
  done < <(find "${target}" -name "*.md" -not -name ".gitkeep" -mtime "+${RETENTION_DAYS}" -print0 2>/dev/null)
done

# 更新 status.json
intel_count=$(find "${PIPELINE_DIR}/intel" -name "*.md" -not -name ".gitkeep" 2>/dev/null | wc -l | tr -d ' ')
drafts_count=$(find "${PIPELINE_DIR}/drafts" -name "*.md" -not -name ".gitkeep" 2>/dev/null | wc -l | tr -d ' ')
reviews_count=$(find "${PIPELINE_DIR}/reviews" -name "*.md" -not -name ".gitkeep" 2>/dev/null | wc -l | tr -d ' ')

cat > "${PIPELINE_DIR}/status.json" << EOF
{
  "lastResearch": $(python3 -c "import json; f=open('${PIPELINE_DIR}/status.json'); d=json.load(f); print(json.dumps(d.get('lastResearch')))" 2>/dev/null || echo "null"),
  "lastCleanup": "${TIMESTAMP}",
  "pendingItems": { "intel": ${intel_count}, "drafts": ${drafts_count}, "reviews": ${reviews_count} }
}
EOF

echo "[${TIMESTAMP}] cleanup done: removed=${cleaned} remaining: intel=${intel_count} drafts=${drafts_count} reviews=${reviews_count}"
