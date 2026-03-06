#!/usr/bin/env bash
# OpenClaw host script: ollama-auto-restart.sh
# Purpose: Ollama health check and automatic restart
# Usage: ollama-auto-restart.sh [--max-retries 3]

set -euo pipefail

OLLAMA_API="${OLLAMA_API:-http://localhost:11434}"
MAX_RETRIES="${1:-3}"
RETRY_DELAY=5

echo "=== Ollama Health Check ==="
echo "Checking $OLLAMA_API"

for ((i=1; i<=MAX_RETRIES; i++)); do
  if curl -s "$OLLAMA_API/api/tags" > /dev/null 2>&1; then
    echo "✓ Ollama is healthy (attempt $i)"
    exit 0
  fi
  
  echo "✗ Ollama health check failed (attempt $i/$MAX_RETRIES)"
  
  if [[ $i -lt $MAX_RETRIES ]]; then
    echo "Waiting ${RETRY_DELAY}s before retry..."
    sleep $RETRY_DELAY
  else
    echo "All retries exhausted. Attempting restart..."
    
    # Kill and restart Ollama
    if pgrep ollama > /dev/null; then
      echo "Killing Ollama process..."
      pkill ollama || true
      sleep 3
    fi
    
    # Restart via launchctl (if registered)
    if launchctl list | grep -q ollama 2>/dev/null; then
      echo "Restarting via launchctl..."
      launchctl stop com.ollama.ollama 2>/dev/null || true
      sleep 2
      launchctl start com.ollama.ollama 2>/dev/null || true
    else
      echo "⚠️  Ollama not managed by launchctl. Manual restart needed."
      exit 1
    fi
    
    # Verify restart
    sleep 5
    if curl -s "$OLLAMA_API/api/tags" > /dev/null 2>&1; then
      echo "✓ Ollama restarted successfully"
      exit 0
    else
      echo "✗ Ollama restart failed"
      exit 1
    fi
  fi
done
