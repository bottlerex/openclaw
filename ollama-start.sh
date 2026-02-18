#\!/bin/bash
# Ollama startup with external drive fallback
# External: 7 models (58.7GB) | Local: 2 core models (4.6GB)
# Fallback triggers when external drive is unmounted or inaccessible

export HOME=/Users/rexmacmini
export OLLAMA_HOST=0.0.0.0
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_NUM_PARALLEL=4
export OLLAMA_MAX_LOADED_MODELS=2
export OLLAMA_MAX_QUEUE=512
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

LOG=/Users/rexmacmini/.ollama/logs
EXT_DRIVE="/Volumes/Black Rex/OllamaModels"
LOCAL_MODELS="/Users/rexmacmini/.ollama/models"

# Use test -d (launchd has no ls permission on external volumes)
if [ -d "$EXT_DRIVE/blobs" ]; then
    export OLLAMA_MODELS="$EXT_DRIVE"
    echo "[$(date)] External drive → 7 models" >> "$LOG/watchdog.log"
else
    export OLLAMA_MODELS="$LOCAL_MODELS"
    echo "[$(date)] FALLBACK local → 2 models (qwen2.5-coder + nomic-embed)" >> "$LOG/watchdog.log"
fi

exec /opt/homebrew/bin/ollama serve \
    >>"$LOG/ollama.log" \
    2>>"$LOG/ollama.error.log"
