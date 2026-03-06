#!/usr/bin/env bash
# OpenClaw host script: notify.sh
# Purpose: Send notifications via Telegram/email
# Usage: notify.sh --service SERVICE --severity INFO|WARN|ERROR --message "MSG"

set -euo pipefail

service=""
severity="INFO"
message=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)
      service="$2"
      shift 2
      ;;
    --severity)
      severity="$2"
      shift 2
      ;;
    --message)
      message="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$message" ]]; then
  echo "Usage: notify.sh --service SERVICE --severity LEVEL --message MSG" >&2
  exit 1
fi

# 構建通知內容
timestamp=$(date '+%Y-%m-%d %H:%M:%S')
notification="[$severity] $service @ $timestamp\n$message"

echo "Notification: $notification"

# Telegram 通知（如果配置了 TELEGRAM_TOKEN）
if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "Sending to Telegram..."
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=$notification" \
    > /dev/null && echo "✓ Telegram sent" || echo "✗ Telegram failed"
else
  echo "⚠️  Telegram credentials not configured"
fi

# 本地日誌記錄
log_file="/tmp/openclaw-notifications.log"
echo "$notification" >> "$log_file"
echo "✓ Logged to $log_file"
