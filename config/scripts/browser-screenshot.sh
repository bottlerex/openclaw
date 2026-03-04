#!/usr/bin/env bash
# browser-screenshot.sh — URL → 截圖 PNG
# 用法 (容器內): /home/node/.openclaw/scripts/browser-screenshot.sh <url> [output_path]
set -euo pipefail

URL="${1:?用法: browser-screenshot.sh <url> [output_path]}"
OUTPUT="${2:-/tmp/screenshot-$(date +%s).png}"
TIMEOUT_MS="${3:-10000}"
BROWSER="openclaw browser --browser-profile openclaw"

# 確保瀏覽器啟動
${BROWSER} status >/dev/null 2>&1 || ${BROWSER} start

# 開啟頁面
${BROWSER} open "${URL}"

# 等待頁面載入
${BROWSER} wait --timeout-ms "${TIMEOUT_MS}" 2>/dev/null || true

# 截圖
SCREENSHOT_RESULT=$(${BROWSER} screenshot 2>&1)

# 如果 screenshot 輸出是檔案路徑，複製到指定位置
if [ -f "${SCREENSHOT_RESULT}" ] && [ "${SCREENSHOT_RESULT}" != "${OUTPUT}" ]; then
  cp "${SCREENSHOT_RESULT}" "${OUTPUT}"
elif echo "${SCREENSHOT_RESULT}" | grep -q "saved\|png\|jpg"; then
  # 嘗試從輸出中提取檔案路徑
  SAVED_PATH=$(echo "${SCREENSHOT_RESULT}" | grep -oE '/[^ ]+\.(png|jpg)' | head -1)
  if [ -n "${SAVED_PATH}" ] && [ -f "${SAVED_PATH}" ]; then
    cp "${SAVED_PATH}" "${OUTPUT}"
  fi
fi

echo "{\"url\":\"${URL}\",\"output\":\"${OUTPUT}\",\"status\":\"done\"}"
