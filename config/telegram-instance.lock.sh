#!/bin/bash
# Telegram Instance Lock - 防止多個實例同時運行
# 在 Telegram provider 啟動時執行此檢查

LOCK_FILE="/tmp/telegram-provider.lock"
PID=$$
TIMEOUT=300  # 5 minutes

# 檢查現有 lock
if [ -f "$LOCK_FILE" ]; then
    OLD_PID=$(cat "$LOCK_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "ERROR: Telegram provider 已在運行 (PID: $OLD_PID)" >&2
        exit 1
    else
        echo "[$(date)] 清理過期的 lock 文件 (PID: $OLD_PID)"
        rm -f "$LOCK_FILE"
    fi
fi

# 建立新 lock
echo "$PID" > "$LOCK_FILE"
echo "[$(date)] Telegram instance lock 已建立 (PID: $PID)"

# 設置 trap 在退出時清理 lock
cleanup() {
    if [ -f "$LOCK_FILE" ] && [ "$(cat $LOCK_FILE)" = "$PID" ]; then
        rm -f "$LOCK_FILE"
        echo "[$(date)] Telegram instance lock 已清理"
    fi
}
trap cleanup EXIT

# 保持 lock 直到進程退出
wait
