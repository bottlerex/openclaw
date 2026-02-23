#!/bin/bash
# Health Scan - 只掃描 personal-ai + openclaw，不刪除
# 有問題才通知，exit 1 = 有可清理項

REPORT_FILE="/tmp/health-scan-report.txt"
PAI_DIR="$HOME/Project/active_projects/personal-ai-assistant"
OC_DIR="$HOME/openclaw"
export PATH="$HOME/.orbstack/bin:$PATH"

echo "=== 瘦身掃描 $(date +%Y-%m-%d) ===" > "$REPORT_FILE"
ISSUES=0

# 1. Docker dangling images + build cache
DANGLING=$(docker images -f "dangling=true" -q 2>/dev/null | wc -l | xargs)
CACHE_SIZE=$(docker system df --format "{{.Size}}" 2>/dev/null | sed -n "4p")
if [ "${DANGLING:-0}" -gt 0 ]; then
  echo "[Docker] $DANGLING 個 dangling images" >> "$REPORT_FILE"
  ISSUES=$((ISSUES + 1))
fi
if [ -n "$CACHE_SIZE" ] && [ "$CACHE_SIZE" != "0B" ]; then
  echo "[Docker] Build cache: $CACHE_SIZE" >> "$REPORT_FILE"
  ISSUES=$((ISSUES + 1))
fi

# 2. personal-ai venv (只檢查多餘的)
for v in "$PAI_DIR"/venv_* "$PAI_DIR"/test_venv; do
  if [ -d "$v" ]; then
    SIZE=$(du -sh "$v" 2>/dev/null | cut -f1)
    echo "[PAI] 多餘 venv: $(basename $v) ($SIZE)" >> "$REPORT_FILE"
    ISSUES=$((ISSUES + 1))
  fi
done

# 3. OpenClaw .bak 檔
BAKS=$(find "$OC_DIR" -name "*.bak*" 2>/dev/null | grep -v node_modules)
BAK_COUNT=$(echo "$BAKS" | grep -c "[^[:space:]]" 2>/dev/null || echo 0)
if [ "$BAK_COUNT" -gt 0 ]; then
  echo "[OC] $BAK_COUNT 個備份檔" >> "$REPORT_FILE"
  echo "$BAKS" | head -5 >> "$REPORT_FILE"
  ISSUES=$((ISSUES + 1))
fi

# 4. PAI .bak/.tmp 檔
PAI_BAKS=$(find "$PAI_DIR" -maxdepth 2 \( -name "*.bak*" -o -name "*.tmp" \) -not -path "*/venv*" 2>/dev/null)
PAI_BAK_COUNT=$(echo "$PAI_BAKS" | grep -c "[^[:space:]]" 2>/dev/null || echo 0)
if [ "$PAI_BAK_COUNT" -gt 0 ]; then
  echo "[PAI] $PAI_BAK_COUNT 個備份/暫存檔" >> "$REPORT_FILE"
  echo "$PAI_BAKS" >> "$REPORT_FILE"
  ISSUES=$((ISSUES + 1))
fi

# 5. 大 log (>50MB)
LARGE_LOGS=$(find "$OC_DIR/logs" "$PAI_DIR" /tmp -maxdepth 2 -name "*.log" -size +50M 2>/dev/null)
if [ -n "$LARGE_LOGS" ]; then
  echo "[Logs] 大檔:" >> "$REPORT_FILE"
  ls -lh $LARGE_LOGS >> "$REPORT_FILE"
  ISSUES=$((ISSUES + 1))
fi

# 6. __pycache__ (非 venv, 只看 personal-ai)
PYCACHE=$(find "$PAI_DIR" -name "__pycache__" -not -path "*/venv*" -not -path "*/node_modules/*" 2>/dev/null)
if [ -n "$PYCACHE" ]; then
  TOTAL=$(du -sh $PYCACHE 2>/dev/null | tail -1 | cut -f1)
  echo "[PAI] __pycache__: $TOTAL" >> "$REPORT_FILE"
fi

# Summary
echo "" >> "$REPORT_FILE"
if [ "$ISSUES" -gt 0 ]; then
  echo "發現 $ISSUES 個可清理項，請決定是否清理。" >> "$REPORT_FILE"
else
  echo "系統健康，無需清理。" >> "$REPORT_FILE"
fi

cat "$REPORT_FILE"
[ "$ISSUES" -gt 0 ] && exit 1 || exit 0
