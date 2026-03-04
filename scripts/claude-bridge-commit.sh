#!/usr/bin/env bash
# claude-bridge-commit.sh — 自動 git add + commit Bridge 產出的變更
# 用途: 在 review 通過後自動提交
set -euo pipefail

OUTPUT_DIR="/Users/rexmacmini/Project/active_projects/.claude-bridge"
LOG_FILE="${OUTPUT_DIR}/bridge.log"

TASK_ID="${1:?用法: claude-bridge-commit.sh <task_id> [working_dir] [commit_msg]}"
WORKING_DIR="${2:-/Users/rexmacmini/openclaw}"
COMMIT_MSG="${3:-"bridge(${TASK_ID}): auto-commit via claude-bridge-pipeline"}"

# 確認是 git repo
if [ ! -d "${WORKING_DIR}/.git" ]; then
  echo '{"committed":false,"reason":"not a git repo"}'
  exit 0
fi

cd "${WORKING_DIR}"

# 檢查是否有變更
if git diff --quiet && git diff --cached --quiet; then
  echo '{"committed":false,"reason":"no changes to commit"}'
  exit 0
fi

# Stage 所有變更
git add -A

# Commit
git commit -m "${COMMIT_MSG}" --no-verify 2>&1 || {
  echo '{"committed":false,"reason":"git commit failed"}'
  exit 1
}

COMMIT_HASH=$(git rev-parse --short HEAD)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "[${NOW}] task=${TASK_ID} commit=${COMMIT_HASH}" >> "${LOG_FILE}"
echo "{\"committed\":true,\"hash\":\"${COMMIT_HASH}\",\"message\":\"${COMMIT_MSG}\"}"
