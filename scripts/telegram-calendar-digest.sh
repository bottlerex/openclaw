#!/bin/bash
# 發送日程摘要到 Telegram

# 配置
BOT_TOKEN="${TELEGRAM_BOT_TOKEN}"
CHAT_ID="${TELEGRAM_CHAT_ID}"
CACHE_FILE=~/openclaw/calendar_cache/calendar.ics
LOG_FILE=~/openclaw/logs/telegram-digest.log

if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
    echo "[2026-02-13 18:05:04] ❌ Telegram 未配置" >> $LOG_FILE
    exit 1
fi

# 提取今日事件 (簡易版)
TODAY=$(date '+%Y%m%d')
EVENTS=$(grep -B 2 'SUMMARY:' $CACHE_FILE | grep -E "DTSTART.*$TODAY|SUMMARY" | sed 'N;s/\n/ /' | head -5)

if [ -z "$EVENTS" ]; then
    MESSAGE="📅 *今日日程*\n\n暫無行程"
else
    MESSAGE="📅 *今日日程*\n\n$EVENTS"
fi

# 發送到 Telegram
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    -d "text=${MESSAGE}" \
    -d "parse_mode=markdown")

if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo "[2026-02-13 18:05:04] ✓ 摘要已發送" >> $LOG_FILE
else
    echo "[2026-02-13 18:05:04] ❌ 發送失敗: $RESPONSE" >> $LOG_FILE
fi
