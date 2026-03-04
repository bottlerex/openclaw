#!/usr/bin/env bash
# claude-bridge-review.sh — 審核 Claude Bridge 輸出品質
# 用途: 讀取 result 檔案，檢查品質，輸出 JSON 結果
set -euo pipefail

OUTPUT_DIR="/Users/rexmacmini/Project/active_projects/.claude-bridge"
LOG_FILE="${OUTPUT_DIR}/bridge.log"

TASK_ID="${1:?用法: claude-bridge-review.sh <task_id> [working_dir]}"
WORKING_DIR="${2:-/Users/rexmacmini/openclaw}"

# 嘗試找 json 或 md 格式的結果檔
RESULT_FILE=""
if [ -f "${OUTPUT_DIR}/result-${TASK_ID}.json" ]; then
  RESULT_FILE="${OUTPUT_DIR}/result-${TASK_ID}.json"
elif [ -f "${OUTPUT_DIR}/result-${TASK_ID}.md" ]; then
  RESULT_FILE="${OUTPUT_DIR}/result-${TASK_ID}.md"
else
  echo '{"pass":false,"reason":"result file not found","files_changed":0}'
  exit 1
fi

# === 檢查 1: 檔案大小 ===
FILE_SIZE=$(wc -c < "${RESULT_FILE}" | tr -d ' ')
if [ "${FILE_SIZE}" -lt 10 ]; then
  echo '{"pass":false,"reason":"output too small (<10 bytes)","files_changed":0}'
  exit 0
fi

# === 檢查 2: status 檢查 ===
if grep -qi '"status"[[:space:]]*:[[:space:]]*"error"' "${RESULT_FILE}" 2>/dev/null || \
   grep -qi '^- status: error' "${RESULT_FILE}" 2>/dev/null; then
  echo '{"pass":false,"reason":"status is error","files_changed":0}'
  exit 0
fi

# === 檢查 3: 危險關鍵字 ===
DANGER_PATTERNS="FATAL|panic|segfault|permission denied|EACCES|EPERM"
if grep -qiE "${DANGER_PATTERNS}" "${RESULT_FILE}" 2>/dev/null; then
  MATCHED=$(grep -oiE "${DANGER_PATTERNS}" "${RESULT_FILE}" | head -1)
  echo "{\"pass\":false,\"reason\":\"dangerous keyword: ${MATCHED}\",\"files_changed\":0}"
  exit 0
fi

# === 檢查 4: git diff (如果 working_dir 是 git repo) ===
FILES_CHANGED=0
DIFF_STAT=""
if [ -d "${WORKING_DIR}/.git" ]; then
  DIFF_STAT=$(git -C "${WORKING_DIR}" diff --stat 2>/dev/null || true)
  if [ -n "${DIFF_STAT}" ]; then
    FILES_CHANGED=$(git -C "${WORKING_DIR}" diff --name-only 2>/dev/null | wc -l | tr -d ' ')
  fi
  # 也檢查 staged 的變更
  STAGED_COUNT=$(git -C "${WORKING_DIR}" diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')
  FILES_CHANGED=$((FILES_CHANGED + STAGED_COUNT))
fi

# === 檢查 5: 變更範圍安全閥 (>20 檔案視為可疑) ===
if [ "${FILES_CHANGED}" -gt 20 ]; then
  echo "{\"pass\":false,\"reason\":\"too many files changed (${FILES_CHANGED})\",\"files_changed\":${FILES_CHANGED}}"
  exit 0
fi

# === 全部通過 ===
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "[${NOW}] task=${TASK_ID} review=pass files_changed=${FILES_CHANGED}" >> "${LOG_FILE}"
echo "{\"pass\":true,\"reason\":\"all checks passed\",\"files_changed\":${FILES_CHANGED}}"
