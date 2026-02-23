#!/bin/bash
# Weekly Summary — 本週工作+投資
export PATH=$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:$PATH
BOT_TOKEN="8529641247:AAEKWoGZLPilF7C6L3IeO7dcLMKXwQ5nFp8"
CHAT_ID="150944774"

# Step 1: Work Tracker 本週記錄
WORK_LOGS=$(curl -s --max-time 10 "http://localhost:8001/api/work-logs?days=7" 2>/dev/null)
WORK_MSG=$(python3 << 'PYEOF'
import json, sys
try:
    data = json.loads('''WORK_PLACEHOLDER''')
    logs = data if isinstance(data, list) else data.get('data', data.get('logs', []))
    if not isinstance(logs, list): logs = []
    projects = {}
    total_min = 0
    for log in logs:
        proj = log.get('project', 'misc')
        desc = log.get('description', '')
        dur = log.get('duration_min', 0) or 0
        projects.setdefault(proj, []).append(desc)
        total_min += dur
    lines = [f'本週工作 {len(logs)} 項 ({total_min} 分鐘)']
    for proj, descs in sorted(projects.items(), key=lambda x: -len(x[1])):
        lines.append(f'  {proj}: {len(descs)} 項')
        for d in descs[:3]:
            lines.append(f'    - {d[:60]}')
        if len(descs) > 3:
            lines.append(f'    ...+{len(descs)-3} 項')
    print('\n'.join(lines))
except Exception as e:
    print(f'Work Tracker: 資料取得失敗 ({e})')
PYEOF
)
# Fix: pass actual data via stdin
WORK_MSG=$(echo "$WORK_LOGS" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    logs = data if isinstance(data, list) else data.get('data', data.get('logs', []))
    if not isinstance(logs, list): logs = []
    projects = {}
    total_min = 0
    for log in logs:
        proj = log.get('project', 'misc')
        desc = log.get('description', '')
        dur = log.get('duration_min', 0) or 0
        projects.setdefault(proj, []).append(desc)
        total_min += dur
    lines = [f'本週工作 {len(logs)} 項 ({total_min} 分鐘)']
    for proj, descs in sorted(projects.items(), key=lambda x: -len(x[1])):
        lines.append(f'  {proj}: {len(descs)} 項')
        for d in descs[:3]:
            lines.append(f'    - {d[:60]}')
        if len(descs) > 3:
            lines.append(f'    ...+{len(descs)-3} 項')
    print('\n'.join(lines))
except Exception as e:
    print(f'Work Tracker: 資料取得失敗 ({e})')
" 2>/dev/null)

# Step 2: 台積電本週表現
TSMC=$(curl -s --max-time 10 http://localhost:8888/api/v1/indicators/2330.TW/latest 2>/dev/null)
TSMC_MSG=$(echo "$TSMC" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    close=d.get('latest_close','N/A')
    ma5=d.get('ma_5','N/A')
    rsi=d.get('rsi_14','N/A')
    trend=d.get('trend_signal','N/A')
    if isinstance(rsi, float): rsi=f'{rsi:.1f}'
    print(f'台積電: {close} | MA5: {ma5} | RSI: {rsi} | {trend}')
except: print('台積電: 資料取得失敗')
" 2>/dev/null)

# Step 3: 組裝週報
MSG="[週報] $(date '+%m/%d')
$WORK_MSG

台股:
  $TSMC_MSG"

# Step 4: 發送 Telegram
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d chat_id="$CHAT_ID" \
  --data-urlencode text="$MSG" > /dev/null 2>&1

echo "$MSG"
