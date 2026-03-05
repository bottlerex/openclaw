#!/bin/bash
# OpenClaw Shell Executor - 安全的 shell 命令執行器
# 用於 Agent 執行系統命令，帶 timeout 和 safety checks

set -o pipefail

TIMEOUT=${TIMEOUT:-30}  # 預設 30 秒超時
CMD="$@"

# Safety checks
if [ -z "$CMD" ]; then
    echo "ERROR: No command provided" >&2
    exit 1
fi

# 禁止的危險命令
DANGEROUS_PATTERNS="(rm -rf|:(){|<\\(|fork|sudo)"
if echo "$CMD" | grep -qE "$DANGEROUS_PATTERNS"; then
    echo "ERROR: Command contains dangerous patterns" >&2
    exit 1
fi

# 使用 timeout 執行命令
timeout "$TIMEOUT" bash -c "$CMD" 2>&1
EXIT_CODE=$?

# 處理 timeout
if [ $EXIT_CODE -eq 124 ]; then
    echo "ERROR: Command timed out after ${TIMEOUT}s" >&2
    exit 1
fi

exit $EXIT_CODE
