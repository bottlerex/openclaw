#!/bin/bash
# OpenClaw 啟動 hook - 執行 Telegram lock wrapper

if [ -f /home/node/.openclaw/scripts/telegram-lock-wrapper.sh ]; then
    bash /home/node/.openclaw/scripts/telegram-lock-wrapper.sh &
    WRAPPER_PID=$!
    echo "[startup-hook] Telegram lock wrapper started (PID: $WRAPPER_PID)"
fi
