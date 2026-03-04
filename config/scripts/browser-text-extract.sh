#!/usr/bin/env bash
# browser-text-extract.sh — URL → 頁面文字 (accessibility tree)
# 用法 (容器內): /home/node/.openclaw/scripts/browser-text-extract.sh <url> [output_file]
set -euo pipefail

URL="${1:?用法: browser-text-extract.sh <url> [output_file]}"
OUTPUT="${2:-}"
TIMEOUT_MS="${3:-10000}"
BROWSER="openclaw browser --browser-profile openclaw"

# 確保瀏覽器啟動
${BROWSER} status >/dev/null 2>&1 || ${BROWSER} start

# 開啟頁面
${BROWSER} open "${URL}"

# 等待頁面載入
${BROWSER} wait --timeout-ms "${TIMEOUT_MS}" 2>/dev/null || true

# 取得頁面結構 (accessibility tree)
SNAPSHOT=$(${BROWSER} snapshot 2>&1)

if [ -n "${OUTPUT}" ]; then
  echo "${SNAPSHOT}" > "${OUTPUT}"
  echo "{\"url\":\"${URL}\",\"output\":\"${OUTPUT}\",\"chars\":${#SNAPSHOT},\"status\":\"done\"}"
else
  echo "${SNAPSHOT}"
fi
