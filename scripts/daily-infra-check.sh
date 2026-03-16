#!/bin/bash
# OpenClaw 每日基礎設施檢查
# 檢測常見問題：PATH 缺失、symlink 斷裂、mount 失效、cron 錯誤
# cron: 0 8 * * * /Users/rexmacmini/openclaw/scripts/daily-infra-check.sh

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ISSUES=()
CONTAINER="openclaw-agent"

# === 1. cron 腳本 PATH 檢查 ===
while IFS= read -r line; do
  script=$(echo "$line" | awk '{for(i=6;i<=NF;i++) if($i ~ /\.sh/) {print $i; exit}}')
  [ -z "$script" ] && continue
  # 展開 ~
  script="${script/#\~/$HOME}"
  [ ! -f "$script" ] && continue
  if grep -q "docker" "$script" 2>/dev/null && ! grep -q "export PATH" "$script" 2>/dev/null; then
    ISSUES+=("CRON_PATH: $script uses docker but has no PATH export")
  fi
done < <(crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$")

# === 2. HTTP/HTTPS 不匹配（18789 是 HTTPS） ===
for f in ~/openclaw/scripts/*.sh ~/.claude/scripts/openclaw-*.sh; do
  [ ! -f "$f" ] && continue
  if grep -v "grep" "$f" 2>/dev/null | grep -q "http://localhost:18789\|http://127.0.0.1:18789"; then
    ISSUES+=("HTTP_MISMATCH: $(basename "$f") uses HTTP to HTTPS port 18789")
  fi
done

# === 3. symlink 健康檢查 ===
for f in ~/.claude/rules/*.md ~/.agent-memory/knowledge/*.md ~/.claude/CLAUDE.md; do
  [ ! -L "$f" ] && continue
  target=$(readlink "$f")
  if [ ! -f "$target" ]; then
    ISSUES+=("SYMLINK_BROKEN: $f -> $target (target missing)")
  elif [ ! -s "$target" ]; then
    ISSUES+=("SYMLINK_EMPTY: $f -> $target (0 bytes)")
  fi
done

# === 4. 容器 mount 可讀性 ===
if docker inspect "$CONTAINER" --format='{{.State.Running}}' 2>/dev/null | grep -q "true"; then
  for path in /home/node/agent-knowledge/system-config.md /home/node/claude-rules/model-scoring.md; do
    if ! docker exec "$CONTAINER" cat "$path" >/dev/null 2>&1; then
      ISSUES+=("MOUNT_UNREADABLE: container cannot read $path")
    fi
  done
else
  ISSUES+=("CONTAINER_DOWN: $CONTAINER is not running")
fi

# === 5. cron log 錯誤掃描 ===
for log in /tmp/openclaw-failover.log /tmp/p0-monitor.log /tmp/p0-monitor-dispatcher.log; do
  [ ! -f "$log" ] && continue
  errors=$(tail -20 "$log" 2>/dev/null | grep -ci "error\|fail\|command not found\|Bad Request" 2>/dev/null || true)
  errors=${errors:-0}
  if [ "$errors" -gt 0 ] 2>/dev/null; then
    last_error=$(tail -20 "$log" | grep -i "error\|fail\|command not found\|Bad Request" | tail -1)
    ISSUES+=("CRON_LOG_ERROR: $(basename "$log"): $last_error")
  fi
done

# === 6. 容器記憶體（只在容器已確認 running 時檢查）===
if docker inspect "$CONTAINER" --format='{{.State.Running}}' 2>/dev/null | grep -q "true"; then
  mem_raw=$(docker stats "$CONTAINER" --no-stream --format '{{.MemPerc}}' 2>/dev/null | tr -d '% \n')
  if [ -n "$mem_raw" ]; then
    mem_int=${mem_raw%%.*}
    if [ "${mem_int:-0}" -gt 80 ]; then
      ISSUES+=("MEM_HIGH: container at ${mem_raw}% memory")
    fi
  fi
fi

# === 輸出 ===
if [ ${#ISSUES[@]} -eq 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M')] infra-check: ALL PASS"
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M')] infra-check: ${#ISSUES[@]} ISSUES FOUND"
for issue in "${ISSUES[@]}"; do
  echo "  - $issue"
done

# Telegram 通知（如果有問題）
MSG="[Infra Check] ${#ISSUES[@]} issues found:"
for issue in "${ISSUES[@]}"; do
  MSG="$MSG\n- $issue"
done

curl -sk -X POST https://localhost:18789/telegram/send \
  -H "Content-Type: application/json" \
  -d "{\"to\": \"150944774\", \"text\": \"$MSG\"}" 2>/dev/null || true

exit 1
