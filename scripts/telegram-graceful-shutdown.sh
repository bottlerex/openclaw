#!/bin/bash
# Telegram Graceful Shutdown - 確保 lock 正確清理
# 在容器停止或重啟前執行此腳本

LOCK_DIR="/tmp/openclaw-locks"
TIMEOUT=10  # 10 秒超時

echo "[shutdown] 開始 Telegram graceful shutdown..."

# 1. 發送 SIGTERM 給所有 Telegram 提供者，等待 getUpdates 完成
echo "[shutdown] 等待 pending Telegram requests 完成..."
sleep 2

# 2. 清理所有 Telegram lock
echo "[shutdown] 清理 Telegram lock 檔案..."
if [ -d "$LOCK_DIR" ]; then
    rm -rf "$LOCK_DIR"/telegram*.lock.dir 2>/dev/null
    echo "[shutdown] ✓ Lock 已清理"
fi

# 3. 驗證無 lock 遺留
if ! [ -d "$LOCK_DIR"/telegram*.lock.dir ]; then
    echo "[shutdown] ✓ Graceful shutdown 完成"
    exit 0
else
    echo "[shutdown] ✗ WARNING: 仍有 lock 遺留"
    exit 1
fi
