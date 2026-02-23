#!/bin/bash
# OpenClaw Calendar ICS Sync (curl version)

ICS_URL="https://calendar.google.com/calendar/ical/bottle.rex%40gmail.com/private-45368637f4ab056110db20e8b0f3580b/basic.ics"
CACHE_DIR=~/openclaw/calendar_cache
LOG_FILE=~/openclaw/logs/calendar-sync.log

mkdir -p $CACHE_DIR ~/openclaw/logs

echo "[2026-02-13 18:00:37] 開始同步..." >> $LOG_FILE

# 下載 ICS
curl -s "$ICS_URL" -o $CACHE_DIR/calendar.ics

if [ -f $CACHE_DIR/calendar.ics ] && [ -s $CACHE_DIR/calendar.ics ]; then
    EVENT_COUNT=$(grep -c 'BEGIN:VEVENT' $CACHE_DIR/calendar.ics)
    echo "[2026-02-13 18:00:37] ✓ 同步成功: $EVENT_COUNT 個事件" >> $LOG_FILE
else
    echo "[2026-02-13 18:00:37] ❌ 同步失敗" >> $LOG_FILE
    exit 1
fi
