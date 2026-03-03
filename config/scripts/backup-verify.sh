#!/bin/bash
# Backup & system health verification script
# Called by OpenClaw monitor agent via exec
# Outputs JSON summary for agent consumption

DOCKER="/opt/homebrew/bin/docker"
BACKUP_LOG="$HOME/.claude/logs/backup-monitor-cron.log"

overall="ok"
checks=""

add_check() {
  local name="$1" status="$2" detail="$3"
  [ -n "$checks" ] && checks="$checks,"
  checks="$checks{\"name\":\"$name\",\"status\":\"$status\",\"detail\":\"$detail\"}"
  if [ "$status" = "critical" ]; then overall="critical"
  elif [ "$status" = "warning" ] && [ "$overall" != "critical" ]; then overall="warning"
  fi
}

# 1. Disk usage
disk_pct=$(df -h / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$disk_pct" -ge 90 ] 2>/dev/null; then
  add_check "disk" "critical" "Root disk ${disk_pct}% used"
elif [ "$disk_pct" -ge 80 ] 2>/dev/null; then
  add_check "disk" "warning" "Root disk ${disk_pct}% used"
else
  add_check "disk" "ok" "Root disk ${disk_pct}% used"
fi

# 2. Docker containers
if $DOCKER ps --format '{{.Names}} {{.Status}}' >/dev/null 2>&1; then
  total=$($DOCKER ps -a --format '{{.Names}}' | wc -l | tr -d ' ')
  running=$($DOCKER ps --format '{{.Names}}' | wc -l | tr -d ' ')
  unhealthy=$($DOCKER ps --filter health=unhealthy --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$unhealthy" -gt 0 ]; then
    add_check "docker" "warning" "${running}/${total} running, ${unhealthy} unhealthy"
  else
    add_check "docker" "ok" "${running}/${total} running"
  fi
else
  add_check "docker" "critical" "Docker not accessible"
fi

# 3. OpenClaw container
oc_status=$($DOCKER inspect --format '{{.State.Status}}' openclaw-agent 2>/dev/null)
if [ "$oc_status" = "running" ]; then
  oc_health=$($DOCKER inspect --format '{{.State.Health.Status}}' openclaw-agent 2>/dev/null)
  if [ "$oc_health" = "healthy" ] || [ "$oc_health" = "" ]; then
    add_check "openclaw" "ok" "Container running"
  else
    add_check "openclaw" "warning" "Container running but health=$oc_health"
  fi
else
  add_check "openclaw" "critical" "Container status: ${oc_status:-not found}"
fi

# 4. Backup cron entry
if crontab -l 2>/dev/null | grep -q backup; then
  add_check "backup_cron" "ok" "Backup cron entry exists"
else
  add_check "backup_cron" "warning" "No backup cron entry found"
fi

# 5. Recent backup log
if [ -f "$BACKUP_LOG" ]; then
  last_line=$(tail -1 "$BACKUP_LOG" 2>/dev/null)
  log_age_sec=$(( $(date +%s) - $(stat -f %m "$BACKUP_LOG" 2>/dev/null || echo 0) ))
  log_age_hr=$(( log_age_sec / 3600 ))
  if [ "$log_age_hr" -gt 48 ]; then
    add_check "backup_log" "warning" "Last log ${log_age_hr}h ago"
  else
    add_check "backup_log" "ok" "Last log ${log_age_hr}h ago"
  fi
else
  add_check "backup_log" "warning" "No backup log found"
fi

# Output JSON
printf '{"status":"%s","timestamp":"%s","checks":[%s]}\n' \
  "$overall" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$checks"
