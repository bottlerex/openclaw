#!/usr/bin/env bash
# claude-bridge-pipeline.sh — 完整閉環: Bridge → Review → Commit
# 用途: OpenClaw 調用後零人工介入完成任務
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="/Users/rexmacmini/Project/active_projects/.claude-bridge"
LOG_FILE="${OUTPUT_DIR}/bridge.log"

TASK_ID="${1:?用法: claude-bridge-pipeline.sh <task_id> <prompt> [working_dir] [auto_commit=false]}"
PROMPT="${2:?缺少 prompt 參數}"
WORKING_DIR="${3:-/Users/rexmacmini/openclaw}"
AUTO_COMMIT="${4:-false}"

mkdir -p "${OUTPUT_DIR}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "[${NOW}] pipeline start task=${TASK_ID} auto_commit=${AUTO_COMMIT}" >> "${LOG_FILE}"

# === Step 1: 執行 Claude Bridge ===
echo "=== Step 1: Executing Claude Bridge ==="
"${SCRIPT_DIR}/claude-bridge.sh" "${TASK_ID}" "${PROMPT}" "${WORKING_DIR}" "json" || {
  echo "PIPELINE FAILED: bridge execution error"
  exit 1
}

# === Step 2: Review ===
echo "=== Step 2: Reviewing result ==="
REVIEW_RESULT=$("${SCRIPT_DIR}/claude-bridge-review.sh" "${TASK_ID}" "${WORKING_DIR}")
echo "Review: ${REVIEW_RESULT}"

# 解析 review 結果
REVIEW_PASS=$(echo "${REVIEW_RESULT}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('pass', False))" 2>/dev/null || echo "False")

if [ "${REVIEW_PASS}" != "True" ]; then
  REASON=$(echo "${REVIEW_RESULT}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('reason', 'unknown'))" 2>/dev/null || echo "unknown")
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "[${NOW}] pipeline task=${TASK_ID} review=FAIL reason=${REASON}" >> "${LOG_FILE}"
  echo "PIPELINE: Review failed — ${REASON}"
  exit 1
fi

# === Step 3: Auto Commit (如果啟用) ===
if [ "${AUTO_COMMIT}" = "true" ]; then
  echo "=== Step 3: Auto committing ==="
  COMMIT_RESULT=$("${SCRIPT_DIR}/claude-bridge-commit.sh" "${TASK_ID}" "${WORKING_DIR}")
  echo "Commit: ${COMMIT_RESULT}"
else
  echo "=== Step 3: Skipped (auto_commit=false) ==="
  COMMIT_RESULT='{"committed":false,"reason":"auto_commit disabled"}'
fi

# === 結果摘要 ===
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "[${NOW}] pipeline task=${TASK_ID} status=complete review=pass commit=${AUTO_COMMIT}" >> "${LOG_FILE}"

echo ""
echo "=== Pipeline Complete ==="
echo "Task:    ${TASK_ID}"
echo "Review:  PASS"
echo "Commit:  ${COMMIT_RESULT}"
echo "Result:  ${OUTPUT_DIR}/result-${TASK_ID}.json"
