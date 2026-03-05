#!/usr/bin/env bash
# daily-research.sh — 透過 OpenClaw gateway 觸發 main agent 執行每日研究
# 用法: daily-research.sh morning|evening
# crontab:
#   0 0 * * *  /Users/rexmacmini/openclaw/scripts/daily-research.sh morning
#   0 10 * * * /Users/rexmacmini/openclaw/scripts/daily-research.sh evening
set -euo pipefail

PERIOD="${1:?用法: daily-research.sh morning|evening}"
DATE=$(date +%Y-%m-%d)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="/Users/rexmacmini/openclaw/config/workspace"
INTEL_DIR="${WORKSPACE}/pipeline/intel"
LOG_FILE="${WORKSPACE}/intel/research.log"
GATEWAY_CLIENT="${SCRIPT_DIR}/ws-gateway-client.mjs"

# 驗證參數
if [[ "${PERIOD}" != "morning" && "${PERIOD}" != "evening" ]]; then
  echo "ERROR: 參數必須是 morning 或 evening"
  exit 1
fi

# 確保目錄存在
mkdir -p "${INTEL_DIR}" "$(dirname "${LOG_FILE}")"

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "[${TIMESTAMP}] starting ${PERIOD} research" >> "${LOG_FILE}"

# 構建研究 prompt
if [[ "${PERIOD}" == "morning" ]]; then
  PROMPT="執行每日早報研究。

參考 intel/RESEARCH-PROMPT.md 的格式指引。

任務:
1. 搜索今日 AI/LLM、開發工具、台股金融科技的重要動態
2. 產出早報摘要（200-400 字，快速掃描）
3. 將結果寫入 pipeline/intel/DAILY-INTEL-${DATE}-morning.md（含 YAML frontmatter）
4. 透過 Telegram 發送摘要給 Rex

格式要求: 繁體中文、簡短直接、附來源連結。"
else
  PROMPT="執行每日晚報研究。

參考 intel/RESEARCH-PROMPT.md 的格式指引。

任務:
1. 深度分析今日最重要的技術趨勢
2. 檢查早報是否有遺漏的重要動態
3. 產出晚報分析（400-800 字，含趨勢觀察和行動建議）
4. 將結果寫入 pipeline/intel/DAILY-INTEL-${DATE}-evening.md（含 YAML frontmatter）
5. 透過 Telegram 發送摘要給 Rex

格式要求: 繁體中文、簡短直接、附來源連結。"
fi

# 透過 gateway WebSocket API 觸發 main agent
if [ -f "${GATEWAY_CLIENT}" ]; then
  echo "[${TIMESTAMP}] sending to gateway via ws-gateway-client.mjs" >> "${LOG_FILE}"
  node "${GATEWAY_CLIENT}" -q chat.send agent:main:main "${PROMPT}" 2>> "${LOG_FILE}" || {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: gateway trigger failed (exit=$?)" >> "${LOG_FILE}"
    exit 1
  }
else
  echo "[${TIMESTAMP}] ERROR: gateway client not found at ${GATEWAY_CLIENT}" >> "${LOG_FILE}"
  exit 1
fi

# 更新 pipeline status.json
PIPELINE_STATUS="${WORKSPACE}/pipeline/status.json"
if [ -f "${PIPELINE_STATUS}" ]; then
  python3 -c "
import json
with open('${PIPELINE_STATUS}') as f:
    d = json.load(f)
d['lastResearch'] = '${TIMESTAMP}'
with open('${PIPELINE_STATUS}', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
" 2>/dev/null || true
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${PERIOD} research triggered successfully" >> "${LOG_FILE}"
