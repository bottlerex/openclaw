#!/usr/bin/env bash
# OpenClaw host script: ollama-manager.sh
# Purpose: Ollama model and cache management
# Usage: ollama-manager.sh {list|status|pull|clean|validate}

set -euo pipefail

action="${1:-status}"

# Ollama socket/API endpoint
OLLAMA_API="${OLLAMA_API:-http://localhost:11434}"

case "$action" in
  list)
    echo "=== Ollama Models ==="
    curl -s "$OLLAMA_API/api/tags" 2>/dev/null | jq '.models[] | {name: .name, size: .size, modified_at: .modified_at}' || echo "Failed to fetch models"
    ;;
  
  status)
    echo "=== Ollama Status ==="
    if curl -s "$OLLAMA_API/api/tags" > /dev/null 2>&1; then
      echo "✓ Ollama service is running"
      echo ""
      echo "Models loaded:"
      curl -s "$OLLAMA_API/api/tags" 2>/dev/null | jq '.models | length' | xargs echo "  Total:"
    else
      echo "✗ Ollama service is NOT running"
      exit 1
    fi
    ;;
  
  pull)
    model_name="${2:-}"
    if [[ -z "$model_name" ]]; then
      echo "Usage: ollama-manager.sh pull <model_name>" >&2
      exit 1
    fi
    echo "Pulling model: $model_name"
    curl -X POST "$OLLAMA_API/api/pull" -d "{\"name\":\"$model_name\"}"
    ;;
  
  clean)
    echo "Cleaning Ollama cache..."
    # 刪除 Ollama 的臨時檔案（需要知道具體位置）
    if [[ -d ~/.ollama/models ]]; then
      du -sh ~/.ollama/models
      echo "To clean, use: rm -rf ~/.ollama/models/blobs/sha256-*"
    fi
    ;;
  
  validate)
    echo "Validating Ollama setup..."
    # 檢查進程
    if pgrep ollama > /dev/null; then
      echo "✓ Ollama process running"
    else
      echo "✗ Ollama process NOT running"
    fi
    # 檢查 API
    if curl -s "$OLLAMA_API/api/tags" > /dev/null 2>&1; then
      echo "✓ Ollama API responsive"
    else
      echo "✗ Ollama API NOT responsive"
    fi
    ;;
  
  *)
    echo "Usage: ollama-manager.sh {list|status|pull|clean|validate}" >&2
    exit 1
    ;;
esac
