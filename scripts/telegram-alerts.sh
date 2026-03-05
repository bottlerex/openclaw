#!/bin/bash
# OpenClaw Telegram Alert System
# Sends alerts to Telegram chat

# Configuration (set via environment or .env)
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# Alert log
ALERT_LOG="/tmp/telegram-alerts.log"

log() {
  local timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  echo "[$timestamp] $1" >> "$ALERT_LOG"
}

# Check if Telegram is configured
check_telegram_config() {
  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    log "❌ Telegram not configured (missing BOT_TOKEN or CHAT_ID)"
    return 1
  fi
  return 0
}

# Send alert to Telegram
send_telegram_alert() {
  local severity=$1  # CRITICAL, WARNING, INFO
  local message=$2

  if ! check_telegram_config; then
    return 1
  fi

  # Add emoji based on severity
  local emoji="ℹ️"
  case "$severity" in
    "CRITICAL") emoji="🔴" ;;
    "WARNING")  emoji="🟡" ;;
    "INFO")     emoji="ℹ️" ;;
  esac

  # Format message
  local formatted_msg="$emoji *[$severity]* OpenClaw\n\n$message"

  # Send via Telegram Bot API
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{
      \"chat_id\": \"$TELEGRAM_CHAT_ID\",
      \"text\": \"$formatted_msg\",
      \"parse_mode\": \"Markdown\"
    }" > /dev/null 2>&1

  if [ $? -eq 0 ]; then
    log "✅ Alert sent: [$severity] $message"
    return 0
  else
    log "❌ Failed to send alert: [$severity] $message"
    return 1
  fi
}

# Example alerts
send_p0_alert() {
  local p0_type=$1
  local details=$2

  send_telegram_alert "CRITICAL" "P0 Event Detected\n\nType: $p0_type\nDetails: $details\n\nAuto-recovery initiated."
}

send_update_alert() {
  local version=$1

  send_telegram_alert "INFO" "OpenClaw Update Available\n\nNew version: $version\n\nRun \`docker-compose pull && docker-compose up -d\` to update."
}

send_daily_summary() {
  local summary=$1

  send_telegram_alert "INFO" "Daily Maintenance Summary\n\n$summary"
}

# If called with arguments, send alert
if [ $# -gt 0 ]; then
  case "$1" in
    "p0")
      send_p0_alert "$2" "$3"
      ;;
    "update")
      send_update_alert "$2"
      ;;
    "summary")
      send_daily_summary "$2"
      ;;
    *)
      send_telegram_alert "$1" "$2"
      ;;
  esac
fi
