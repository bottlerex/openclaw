#!/bin/bash
# Heartbeat — 每 30 分鐘輕量健康檢查 + 自動修復
# 正常時靜默，異常時通知 Telegram 並嘗試修復
export PATH=$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:$PATH
BOT_TOKEN="8529641247:AAEKWoGZLPilF7C6L3IeO7dcLMKXwQ5nFp8"
CHAT_ID="150944774"
LOG="$HOME/openclaw/logs/heartbeat.log"

ISSUES=""
REPAIRS=""

# 1. Docker containers — 非 Up 的自動重啟
while IFS=$'\t' read -r name status; do
  [ -z "$name" ] && continue
  if [[ ! "$status" =~ ^Up ]]; then
    docker restart "$name" 2>/dev/null
    REPAIRS="$REPAIRS  - 重啟 $name ($status)
"
  fi
done <<< "$(docker ps -a --format '{{.Names}}\t{{.Status}}' 2>/dev/null)"

# 2. Wrapper Proxy
if ! curl -s --max-time 5 http://localhost:3457/health > /dev/null 2>&1; then
  launchctl stop com.tool-wrapper-proxy 2>/dev/null
  sleep 2
  launchctl start com.tool-wrapper-proxy 2>/dev/null
  REPAIRS="$REPAIRS  - 重啟 wrapper proxy
"
fi

# 3. Ollama
if ! curl -s --max-time 5 http://localhost:11434/api/tags > /dev/null 2>&1; then
  launchctl stop com.ollama.optimized 2>/dev/null
  sleep 2
  launchctl start com.ollama.optimized 2>/dev/null
  REPAIRS="$REPAIRS  - 重啟 Ollama
"
fi

# 4. 磁碟 >90% 自動清理
DISK_PCT=$(df -h / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%')
if [ -n "$DISK_PCT" ] && [ "$DISK_PCT" -gt 90 ] 2>/dev/null; then
  docker system prune -f > /dev/null 2>&1
  REPAIRS="$REPAIRS  - 磁碟 ${DISK_PCT}%，已 prune
"
fi

# 5. 只有異常才通知
TS=$(date '+%m/%d %H:%M')
if [ -n "$REPAIRS" ] || [ -n "$ISSUES" ]; then
  MSG="[heartbeat] $TS 異常修復:
$REPAIRS$ISSUES"
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" \
    --data-urlencode text="$MSG" > /dev/null 2>&1
  echo "$TS ALERT: $MSG" >> "$LOG"
else
  echo "$TS OK" >> "$LOG"
fi

# 6. 日誌裁剪 (保留最近 500 行)
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 500 ]; then
  tail -200 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi
