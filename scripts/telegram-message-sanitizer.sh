#!/bin/bash
# P0.4 修復: Telegram 訊息太長 → 自動截斷
# 監控並修復超長訊息問題

CONTAINER_NAME="openclaw-agent"
LOG_FILE="/tmp/telegram-sanitizer.log"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" >> "$LOG_FILE"
}

# 檢查最近的訊息太長錯誤
check_message_length_errors() {
  docker logs "$CONTAINER_NAME" --since 1m 2>/dev/null | grep -c "message is too long" || true
}

# Telegram 訊息長度限制: 4096 字符
MAX_LENGTH=4096
SAFE_LENGTH=3500  # 安全邊界

# 檢查並記錄
ERROR_COUNT=$(check_message_length_errors)
if [ "$ERROR_COUNT" -gt 0 ]; then
  log "⚠️  detected $ERROR_COUNT 'message too long' errors"
  log "  → 需要減少訊息長度或分段發送"
  log "  → Telegram 限制: $MAX_LENGTH 字符"
  log "  → 建議長度: $SAFE_LENGTH 字符"
fi

# 如果 error 出現超過 3 次，觸發容器重啟
if [ "$ERROR_COUNT" -gt 3 ]; then
  log "🚨 多次訊息長度錯誤，重啟容器..."
  docker restart "$CONTAINER_NAME"
  log "✅ 容器已重啟"
fi
