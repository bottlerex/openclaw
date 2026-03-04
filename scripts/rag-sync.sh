#!/usr/bin/env bash
# rag-sync.sh — 收集知識文件 + 觸發索引
# 用法: scripts/rag-sync.sh [--clear]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
DB_PATH="${PROJECT_ROOT}/data/rag-index.sqlite"
CLEAR_FLAG="${1:-}"

# 預設索引目錄
DIRS=(
  "$HOME/.claude/projects/-Users-rexmacmini/memory"
  "${PROJECT_ROOT}/config/workspace"
)

echo "=== RAG Sync ==="
echo "DB: ${DB_PATH}"
echo ""

# 第一個目錄用 --clear 清除舊數據，後續追加
FIRST=true
for DIR in "${DIRS[@]}"; do
  if [ ! -d "${DIR}" ]; then
    echo "SKIP: ${DIR} (not found)"
    continue
  fi

  echo "--- Indexing: ${DIR} ---"
  EXTRA_ARGS=""
  if [ "${FIRST}" = true ] && [ "${CLEAR_FLAG}" = "--clear" ]; then
    EXTRA_ARGS="--clear"
    FIRST=false
  fi

  node "${SCRIPT_DIR}/rag-index.mjs" \
    --dir "${DIR}" \
    --db "${DB_PATH}" \
    ${EXTRA_ARGS}

  echo ""
done

echo "=== RAG Sync Complete ==="
echo "DB size: $(du -h "${DB_PATH}" | cut -f1)"
