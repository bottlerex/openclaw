#!/usr/bin/env bash
# browser-monitor.sh — URL + 關鍵字 → 變化偵測
# 用法 (容器內): /home/node/.openclaw/scripts/browser-monitor.sh <url> <keyword> [interval_sec] [max_checks]
# 每隔 interval 秒檢查一次頁面，偵測 keyword 出現/消失
set -euo pipefail

URL="${1:?用法: browser-monitor.sh <url> <keyword> [interval_sec] [max_checks]}"
KEYWORD="${2:?缺少 keyword 參數}"
INTERVAL="${3:-60}"
MAX_CHECKS="${4:-10}"
TIMEOUT_MS="10000"
BROWSER="openclaw browser --browser-profile openclaw"
STATE_FILE="/tmp/browser-monitor-$(echo "${URL}" | md5sum | cut -c1-8).txt"

# 確保瀏覽器啟動
${BROWSER} status >/dev/null 2>&1 || ${BROWSER} start

check_count=0
prev_found="unknown"

while [ "${check_count}" -lt "${MAX_CHECKS}" ]; do
  check_count=$((check_count + 1))

  # 開啟/重新載入頁面
  ${BROWSER} open "${URL}" >/dev/null 2>&1
  ${BROWSER} wait --timeout-ms "${TIMEOUT_MS}" 2>/dev/null || true

  # 取得頁面快照
  SNAPSHOT=$(${BROWSER} snapshot 2>&1)

  # 檢查關鍵字
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if echo "${SNAPSHOT}" | grep -qi "${KEYWORD}"; then
    current_found="true"
  else
    current_found="false"
  fi

  # 偵測變化
  if [ "${prev_found}" != "unknown" ] && [ "${prev_found}" != "${current_found}" ]; then
    if [ "${current_found}" = "true" ]; then
      echo "{\"changed\":true,\"type\":\"appeared\",\"keyword\":\"${KEYWORD}\",\"url\":\"${URL}\",\"check\":${check_count},\"time\":\"${NOW}\"}"
    else
      echo "{\"changed\":true,\"type\":\"disappeared\",\"keyword\":\"${KEYWORD}\",\"url\":\"${URL}\",\"check\":${check_count},\"time\":\"${NOW}\"}"
    fi
    exit 0
  fi

  prev_found="${current_found}"

  # 非最後一次才 sleep
  if [ "${check_count}" -lt "${MAX_CHECKS}" ]; then
    sleep "${INTERVAL}"
  fi
done

# 達到最大檢查次數，無變化
echo "{\"changed\":false,\"keyword\":\"${KEYWORD}\",\"url\":\"${URL}\",\"checks\":${MAX_CHECKS},\"last_found\":${current_found}}"
