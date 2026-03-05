#!/bin/bash
# Telegram Lock Wrapper - 為所有 Telegram 提供者強制執行 lock 機制
# 此腳本在容器啟動時被調用

set -e

# 來源 lock 機制
LOCK_SCRIPT="/home/node/.openclaw/telegram-instance.lock.sh"

# 檢查目標進程（getUpdates 或 telegram provider 啟動）
monitor_telegram() {
    local bot_name="${1:-default}"
    
    # 在後台持續監控 Telegram 相關進程
    (
        while true; do
            # 檢查是否有 Telegram 提供者在執行 getUpdates
            if pgrep -f "telegram.*getUpdates|TelegramProvider" >/dev/null 2>&1; then
                # 如果沒有 lock，嘗試獲取
                if ! [ -d /tmp/openclaw-locks/telegram.lock.dir ]; then
                    if bash "$LOCK_SCRIPT" "$bot_name" >/dev/null 2>&1; then
                        echo "[telegram-wrapper] ✓ Lock acquired for $bot_name"
                    fi
                fi
            fi
            
            sleep 10
        done
    ) &
}

# 啟動 lock 監控
monitor_telegram "default"
monitor_telegram "goal-alerts"

echo "[telegram-wrapper] ✓ Telegram lock wrapper initialized"
