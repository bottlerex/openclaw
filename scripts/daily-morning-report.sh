#!/bin/bash
# Daily Morning Report — 台股早報 + 今日行程
export PATH=$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:$PATH
export LANG=en_US.UTF-8
BOT_TOKEN="8529641247:AAEKWoGZLPilF7C6L3IeO7dcLMKXwQ5nFp8"
CHAT_ID="150944774"
API="http://localhost:8888/api/v1"

# Step 1: 觀察名單指標 (來自 stock-thresholds.json)
WATCHLIST_MSG=$(python3 << 'PYEOF'
import json, urllib.request

symbols = [
    ("2330.TW", "台積電"),
    ("2317.TW", "鴻海"),
]
lines = []
for sym, name in symbols:
    try:
        url = f"http://localhost:8888/api/v1/indicators/{sym}/latest"
        with urllib.request.urlopen(url, timeout=10) as r:
            d = json.loads(r.read())
        close = d.get("latest_close", "N/A")
        ma5 = d.get("ma_5", "N/A")
        rsi = d.get("rsi_14")
        trend = d.get("trend_signal", "N/A")
        rsi_s = f"{rsi:.1f}" if isinstance(rsi, (int, float)) else "N/A"
        ma5_s = f"{ma5:.1f}" if isinstance(ma5, (int, float)) else "N/A"
        lines.append(f"  {name}: {close} | MA5: {ma5_s} | RSI: {rsi_s} | {trend}")
    except Exception as e:
        lines.append(f"  {name}: 資料取得失敗")
print("\n".join(lines))
PYEOF
)

# Step 2: 大盤概況 (漲跌幅前 5)
STOCKS_MSG=$(python3 << 'PYEOF'
import json, urllib.request

try:
    url = "http://localhost:8888/api/v1/stocks/list?limit=10"
    with urllib.request.urlopen(url, timeout=10) as r:
        d = json.loads(r.read())
    stocks = d.get("stocks", [])
    # 按漲跌幅排序取前 5
    stocks.sort(key=lambda s: abs(s.get("changePercent", 0)), reverse=True)
    lines = []
    for s in stocks[:5]:
        name = s.get("name", "?")
        price = s.get("currentPrice", "N/A")
        chg = s.get("changePercent", 0)
        sign = "+" if chg >= 0 else ""
        lines.append(f"  {name}: {price} ({sign}{chg:.2f}%)")
    print("\n".join(lines) if lines else "無股票資料")
except Exception:
    print("大盤: 資料取得失敗")
PYEOF
)

# Step 3: Calendar (today's events)
CAL_FILE="$HOME/openclaw/calendar_cache/calendar.ics"
CAL_MSG="今日無行程"
if [ -f "$CAL_FILE" ]; then
  CAL_MSG=$(python3 << 'PYEOF'
import re
from datetime import datetime
today = datetime.now().strftime('%Y%m%d')
events = []
try:
    with open('/Users/rexmacmini/openclaw/calendar_cache/calendar.ics', 'r') as f:
        content = f.read()
    blocks = content.split('BEGIN:VEVENT')
    for block in blocks[1:]:
        dtstart = re.search(r'DTSTART[^:]*:(\d{8})', block)
        summary = re.search(r'SUMMARY:(.*)', block)
        if dtstart and summary:
            if dtstart.group(1) == today:
                events.append(summary.group(1).strip())
except: pass
print('\n'.join(f'  - {e}' for e in events) if events else '今日無行程')
PYEOF
)
fi

# Step 4: 組裝早報
DATE_STR=$(date '+%m/%d %a')
MSG="[早報] ${DATE_STR}

觀察名單:
${WATCHLIST_MSG}

大盤動態:
${STOCKS_MSG}

行程:
${CAL_MSG}"

# Step 5: 發送 Telegram
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d chat_id="$CHAT_ID" \
  --data-urlencode text="$MSG" > /dev/null 2>&1

echo "$MSG"
