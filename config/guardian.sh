#!/bin/bash
# guardian.sh - OpenClaw Guardian (adapted for openclaw-agent container)
# 健康檢查 → doctor --fix → git rollback → cooldown
# 基於 LeoYeAI/openclaw-master-skills 的 guardian.sh 適配

WORKSPACE="${GUARDIAN_WORKSPACE:-$HOME/.openclaw/workspace}"
LOG_FILE="${GUARDIAN_LOG:-/tmp/openclaw-guardian.log}"
CHECK_INTERVAL="${GUARDIAN_CHECK_INTERVAL:-30}"
MAX_REPAIR_ATTEMPTS="${GUARDIAN_MAX_REPAIR:-3}"
COOLDOWN_PERIOD="${GUARDIAN_COOLDOWN:-300}"
HEALTH_URL="${GUARDIAN_HEALTH_URL:-http://127.0.0.1:18789/health}"
OPENCLAW_CMD="${OPENCLAW_CMD:-openclaw}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 健康檢查 (用 HTTP endpoint 取代 pgrep)
is_gateway_healthy() {
    local response
    response=$(curl -s -m 5 "$HEALTH_URL" 2>/dev/null)
    if echo "$response" | grep -q '"ok":true'; then
        return 0
    fi
    return 1
}

# 取得穩定 commit (排除自動提交)
get_stable_commit() {
    git -C "$WORKSPACE" log --all --oneline -50 2>/dev/null | \
        grep -v -E "rollback|daily-backup|auto-backup|guardian-auto|auto-sync" | \
        sed -n '2p' | awk '{print $1}'
}

# doctor --fix 修復
try_doctor_fix() {
    log "嘗試 doctor --fix..."
    $OPENCLAW_CMD doctor --fix >> "$LOG_FILE" 2>&1
    sleep 10
    if is_gateway_healthy; then
        log "doctor --fix 修復成功"
        return 0
    fi
    return 1
}

# git rollback
do_rollback() {
    log "開始 git rollback..."
    local CURRENT_COMMIT
    CURRENT_COMMIT=$(git -C "$WORKSPACE" rev-parse HEAD 2>/dev/null)
    local STABLE_COMMIT
    STABLE_COMMIT=$(get_stable_commit)

    if [ -z "$STABLE_COMMIT" ]; then
        log "無法找到穩定版本，跳過 rollback"
        return 1
    fi

    log "rollback: $CURRENT_COMMIT → $STABLE_COMMIT"
    git -C "$WORKSPACE" reset --hard "$STABLE_COMMIT" >> "$LOG_FILE" 2>&1
    git -C "$WORKSPACE" commit --allow-empty \
        -m "rollback: guardian $CURRENT_COMMIT → $STABLE_COMMIT at $(date '+%Y-%m-%d %H:%M:%S')" \
        >> "$LOG_FILE" 2>&1

    sleep 15
    if is_gateway_healthy; then
        log "rollback 成功，Gateway 已恢復"
        return 0
    else
        log "rollback 後 Gateway 仍異常"
        return 1
    fi
}

# 每日 git snapshot
daily_backup() {
    local today
    today=$(date '+%Y-%m-%d')
    local last_backup_file="/tmp/guardian-last-backup"
    local last_backup=""
    [ -f "$last_backup_file" ] && last_backup=$(cat "$last_backup_file")

    if [ "$last_backup" != "$today" ]; then
        cd "$WORKSPACE" && git add -A && \
        git commit -m "daily-backup: guardian snapshot $today" >> "$LOG_FILE" 2>&1 || true
        echo "$today" > "$last_backup_file"
        log "每日備份完成: $today"
    fi
}

# 修復流程
repair_gateway() {
    local attempt=0
    log "Gateway 異常，開始修復..."

    while [ $attempt -lt $MAX_REPAIR_ATTEMPTS ]; do
        attempt=$((attempt + 1))
        log "修復嘗試 $attempt/$MAX_REPAIR_ATTEMPTS"
        if try_doctor_fix; then
            log "doctor --fix 成功 (第 $attempt 次)"
            return 0
        fi
        sleep 10
    done

    log "doctor --fix 失敗，嘗試 git rollback..."
    if do_rollback; then
        return 0
    fi

    log "所有修復手段失敗，冷卻 ${COOLDOWN_PERIOD}s"
    sleep "$COOLDOWN_PERIOD"
}

# ===== 主循環 =====
log "Guardian 啟動 (check=${CHECK_INTERVAL}s, max_repair=${MAX_REPAIR_ATTEMPTS})"

while true; do
    daily_backup

    if ! is_gateway_healthy; then
        repair_gateway
    fi

    sleep "$CHECK_INTERVAL"
done
