#!/bin/bash
# Telegram Instance Lock v2 - Multi-bot support with auto-cleanup
# 防止多個 Telegram bot 同時執行 getUpdates

LOCK_DIR="/tmp/openclaw-locks"
LOCK_FILE="$LOCK_DIR/telegram.lock"
BOT_ID="${1:-default}"  # 支援多個 bot (default, goal-alerts, 等)
PID=$$
LOCK_TIMEOUT=300  # 5 分鐘超時

# 確保 lock 目錄存在
mkdir -p "$LOCK_DIR"

# 清理過期 lock 檔案（>$LOCK_TIMEOUT 秒）
cleanup_stale_locks() {
    find "$LOCK_DIR" -name "telegram*.lock" -mmin +$((LOCK_TIMEOUT / 60)) -type f -delete 2>/dev/null
}

# 檢查並獲取 lock
acquire_lock() {
    local max_retries=3
    local retry=0
    
    while [ $retry -lt $max_retries ]; do
        # 清理過期 lock
        cleanup_stale_locks
        
        # 嘗試建立 lock 檔案（原子操作）
        if mkdir "$LOCK_FILE.dir" 2>/dev/null; then
            echo "$PID:$BOT_ID:$(date +%s)" > "$LOCK_FILE.dir/pid"
            echo "[$(date)] ✓ Telegram lock acquired (BOT: $BOT_ID, PID: $PID)"
            return 0
        fi
        
        # 檢查舊 PID 是否還活著
        if [ -f "$LOCK_FILE.dir/pid" ]; then
            OLD_PID=$(cut -d: -f1 "$LOCK_FILE.dir/pid")
            OLD_BOT=$(cut -d: -f2 "$LOCK_FILE.dir/pid")
            OLD_TS=$(cut -d: -f3 "$LOCK_FILE.dir/pid")
            CURRENT_TS=$(date +%s)
            ELAPSED=$((CURRENT_TS - OLD_TS))
            
            if ! kill -0 "$OLD_PID" 2>/dev/null || [ $ELAPSED -gt $LOCK_TIMEOUT ]; then
                echo "[$(date)] 清理過期 lock (BOT: $OLD_BOT, PID: $OLD_PID, elapsed: ${ELAPSED}s)"
                rm -rf "$LOCK_FILE.dir" 2>/dev/null
                ((retry++))
                sleep 0.5
                continue
            else
                echo "[$(date)] ✗ ERROR: Telegram already running (BOT: $OLD_BOT, PID: $OLD_PID)" >&2
                return 1
            fi
        fi
        
        ((retry++))
        sleep 1
    done
    
    echo "[$(date)] ✗ ERROR: Failed to acquire Telegram lock after $max_retries retries" >&2
    return 1
}

# 釋放 lock
release_lock() {
    if [ -f "$LOCK_FILE.dir/pid" ]; then
        LOCK_PID=$(cut -d: -f1 "$LOCK_FILE.dir/pid")
        if [ "$LOCK_PID" = "$PID" ]; then
            rm -rf "$LOCK_FILE.dir" 2>/dev/null
            echo "[$(date)] ✓ Telegram lock released (BOT: $BOT_ID, PID: $PID)"
        fi
    fi
}

# 設置 cleanup trap
trap release_lock EXIT

# 獲取 lock
if ! acquire_lock; then
    exit 1
fi

# 保持 lock 直到進程退出
# 使用 busy-wait 而非 wait，以便立即響應信號
while true; do
    sleep 1
done
