#!/bin/bash
# System Health Check + Auto Repair
export PATH=$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:$PATH
BOT_TOKEN="8529641247:AAEKWoGZLPilF7C6L3IeO7dcLMKXwQ5nFp8"
CHAT_ID="150944774"

ISSUES=""
REPAIRS=""

# Step 1: Docker containers
CONTAINERS=$(docker ps -a --format '{{.Names}}\t{{.Status}}' 2>/dev/null)
DOWN_CONTAINERS=""
while IFS=$'\t' read -r name status; do
  if [[ ! "$status" =~ ^Up ]]; then
    DOWN_CONTAINERS="$DOWN_CONTAINERS $name"
    docker restart "$name" 2>/dev/null
    REPAIRS="$REPAIRS\n  - 重啟 $name"
  fi
done <<< "$CONTAINERS"

# Step 2: CPU check
CPU_USAGE=$(top -l 1 -n 0 2>/dev/null | grep "CPU usage" | awk '{print $3}' | tr -d '%')
if [ -n "$CPU_USAGE" ]; then
  CPU_INT=${CPU_USAGE%.*}
  if [ "$CPU_INT" -gt 80 ] 2>/dev/null; then
    TOP_PROCS=$(ps aux --sort=-%cpu 2>/dev/null | head -4 || ps aux | sort -nrk 3 | head -4)
    ISSUES="$ISSUES\n  - CPU ${CPU_USAGE}% (高)\n$TOP_PROCS"
  fi
fi

# Step 3: Disk check
DISK_USAGE=$(df -h / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%')
if [ -n "$DISK_USAGE" ] && [ "$DISK_USAGE" -gt 90 ] 2>/dev/null; then
  docker system prune -f > /dev/null 2>&1
  REPAIRS="$REPAIRS\n  - 磁碟 ${DISK_USAGE}%，已執行 docker prune"
fi

# Step 4: Service endpoints
check_service() {
  local name=$1 url=$2
  if ! curl -s --max-time 5 "$url" > /dev/null 2>&1; then
    ISSUES="$ISSUES\n  - $name 無回應 ($url)"
  fi
}

check_service "Wrapper Proxy" "http://localhost:3457/health"
check_service "Ollama" "http://localhost:11434/api/tags"
check_service "Taiwan Stock" "http://localhost:8888/health"
check_service "Personal AI" "http://localhost:8000/health"

# Step 5: Memory check
MEM_PRESSURE=$(memory_pressure 2>/dev/null | grep "System-wide" | head -1 || echo "")

# Step 6: 組裝報告
CONTAINER_COUNT=$(echo "$CONTAINERS" | wc -l | tr -d ' ')
UP_COUNT=$(echo "$CONTAINERS" | grep -c "^.*Up" || echo "0")

if [ -n "$ISSUES" ] || [ -n "$REPAIRS" ] || [ -n "$DOWN_CONTAINERS" ]; then
  MSG="[健康檢查] 容器 ${UP_COUNT}/${CONTAINER_COUNT} | 磁碟 ${DISK_USAGE}%"
  if [ -n "$REPAIRS" ]; then
    MSG="$MSG
修復:$(echo -e "$REPAIRS")"
  fi
  if [ -n "$ISSUES" ]; then
    MSG="$MSG
問題:$(echo -e "$ISSUES")"
  fi
else
  MSG="[健康檢查] 全部正常 | 容器 ${UP_COUNT}/${CONTAINER_COUNT} | 磁碟 ${DISK_USAGE}%"
fi

# Step 7: 發送 Telegram
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d chat_id="$CHAT_ID" \
  --data-urlencode text="$MSG" \
  -d disable_notification=true > /dev/null 2>&1

echo "$MSG"
