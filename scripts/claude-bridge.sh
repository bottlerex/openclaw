#!/usr/bin/env bash
# claude-bridge.sh — OpenClaw → Claude Code 橋接腳本
# 用途: 讓 OpenClaw 通過 host-exec 調用 Claude Code CLI
# 安全: max-budget 限制, 結果寫入檔案, 非互動模式
set -euo pipefail

# === 配置 ===
MAX_BUDGET="${CLAUDE_BRIDGE_MAX_BUDGET:-5.00}"  # Claude Max 月費固定，此值僅防失控
# Host: /Users/rexmacmini/Project/active_projects/.claude-bridge
# Container: /home/node/projects/.claude-bridge
OUTPUT_DIR="/Users/rexmacmini/Project/active_projects/.claude-bridge"
LOG_FILE="${OUTPUT_DIR}/bridge.log"
TIMEOUT_SEC=300  # 5 分鐘超時

# === 參數 ===
TASK_ID="${1:?用法: claude-bridge.sh <task_id> <prompt> [working_dir] [output_format]}"
PROMPT="${2:?缺少 prompt 參數}"
WORKING_DIR="${3:-/Users/rexmacmini/openclaw}"
OUTPUT_FORMAT="${4:-text}"  # json 或 text

# === 初始化 ===
mkdir -p "${OUTPUT_DIR}"
if [ "${OUTPUT_FORMAT}" = "json" ]; then
  RESULT_FILE="${OUTPUT_DIR}/result-${TASK_ID}.json"
else
  RESULT_FILE="${OUTPUT_DIR}/result-${TASK_ID}.md"
fi
START_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 記錄調用
echo "[${START_TIME}] task=${TASK_ID} budget=${MAX_BUDGET} dir=${WORKING_DIR} format=${OUTPUT_FORMAT}" >> "${LOG_FILE}"

# === 執行 Claude Code ===
# --print: 非互動模式
# --max-budget-usd: 成本安全閥
# --output-format json: 結構化輸出
# --dangerously-skip-permissions: 允許自動執行 (sandbox 環境)
# macOS: 用 perl 實現 timeout
run_with_timeout() {
  perl -e 'alarm shift; exec @ARGV' "$@"
}

# 避免巢狀 session 檢測
unset CLAUDECODE

CLAUDE_OUTPUT=$(run_with_timeout "${TIMEOUT_SEC}" /opt/homebrew/bin/claude \
  -p "${PROMPT}" \
  --max-budget-usd "${MAX_BUDGET}" \
  --output-format json \
  --model haiku \
  --no-session-persistence \
  2>&1) || {
  EXIT_CODE=$?
  END_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if [ "${OUTPUT_FORMAT}" = "json" ]; then
    # JSON 格式錯誤輸出
    ESCAPED_OUTPUT=$(printf '%s' "${CLAUDE_OUTPUT}" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
    cat > "${RESULT_FILE}" << EOF
{"task_id":"${TASK_ID}","status":"error","exit_code":${EXIT_CODE},"start":"${START_TIME}","end":"${END_TIME}","budget":"${MAX_BUDGET}","output":${ESCAPED_OUTPUT}}
EOF
  else
    # Markdown 格式錯誤輸出
    cat > "${RESULT_FILE}" << EOF
# Claude Bridge Result: ${TASK_ID}
- status: error
- exit_code: ${EXIT_CODE}
- start: ${START_TIME}
- end: ${END_TIME}
- budget: \$${MAX_BUDGET}

## Error Output
\`\`\`
${CLAUDE_OUTPUT}
\`\`\`
EOF
  fi

  echo "[${END_TIME}] task=${TASK_ID} status=error exit=${EXIT_CODE}" >> "${LOG_FILE}"
  echo "ERROR: Claude Code failed with exit code ${EXIT_CODE}"
  echo "Result: ${RESULT_FILE}"
  exit "${EXIT_CODE}"
}

END_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# === 寫入結果檔案 ===
if [ "${OUTPUT_FORMAT}" = "json" ]; then
  # JSON 格式成功輸出
  ESCAPED_OUTPUT=$(printf '%s' "${CLAUDE_OUTPUT}" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
  cat > "${RESULT_FILE}" << EOF
{"task_id":"${TASK_ID}","status":"success","start":"${START_TIME}","end":"${END_TIME}","budget":"${MAX_BUDGET}","model":"haiku","output":${ESCAPED_OUTPUT}}
EOF
else
  # Markdown 格式成功輸出
  cat > "${RESULT_FILE}" << EOF
# Claude Bridge Result: ${TASK_ID}
- status: success
- start: ${START_TIME}
- end: ${END_TIME}
- budget: \$${MAX_BUDGET}
- model: haiku

## Output
\`\`\`json
${CLAUDE_OUTPUT}
\`\`\`
EOF
fi

echo "[${END_TIME}] task=${TASK_ID} status=success" >> "${LOG_FILE}"
echo "SUCCESS: Result written to ${RESULT_FILE}"
