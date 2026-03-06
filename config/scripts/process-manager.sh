#!/usr/bin/env bash
# OpenClaw host script: process-manager.sh
# Purpose: Process management (check, restart, list)
# Usage: process-manager.sh check|restart|list [--process NAME]

set -euo pipefail

action="${1:-list}"
process_name="${3:-}"

case "$action" in
  check)
    if [[ -z "$process_name" ]]; then
      echo "Usage: process-manager.sh check --process NAME" >&2
      exit 1
    fi
    # 檢查進程狀態
    if pgrep -f "$process_name" > /dev/null; then
      pgrep -f "$process_name" | head -1 | xargs ps -p
    else
      echo "Process '$process_name' not running"
      exit 1
    fi
    ;;
  
  restart)
    if [[ -z "$process_name" ]]; then
      echo "Usage: process-manager.sh restart --process NAME" >&2
      exit 1
    fi
    # 重啟進程
    if pgrep -f "$process_name" > /dev/null; then
      echo "Killing $process_name..."
      pkill -f "$process_name" || true
      sleep 2
      echo "Waiting for restart (launchctl/systemd)..."
    else
      echo "Process not found, starting..."
    fi
    ;;
  
  list)
    # 列出關鍵進程
    echo "Key processes on Mac mini:"
    for proc in openclaw-agent ollama postgres redis python node; do
      if pgrep -f "$proc" > /dev/null 2>&1; then
        echo "  ✓ $proc"
      else
        echo "  ✗ $proc (not running)"
      fi
    done
    ;;
  
  *)
    echo "Usage: process-manager.sh {check|restart|list} [--process NAME]" >&2
    exit 1
    ;;
esac
