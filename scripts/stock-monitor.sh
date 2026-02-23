#!/bin/bash
# Stock Monitor — 台股閾值警報 (只觸發才通知)
export PATH=$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:$PATH
BOT_TOKEN="8529641247:AAEKWoGZLPilF7C6L3IeO7dcLMKXwQ5nFp8"
CHAT_ID="150944774"
THRESHOLDS_FILE="$HOME/openclaw/workspace/stock-thresholds.json"

# Read thresholds
if [ ! -f "$THRESHOLDS_FILE" ]; then exit 0; fi

# Fetch stock data and check thresholds
ALERTS=$(python3 << 'PYEOF'
import json, urllib.request, sys

# Load thresholds
try:
    with open('/Users/rexmacmini/openclaw/workspace/stock-thresholds.json') as f:
        thresholds = json.load(f)
except:
    sys.exit(0)

alerts = []

# Check watchlist stocks
for item in thresholds.get('watchlist', []):
    symbol = item.get('symbol', '')
    name = item.get('name', symbol)
    try:
        url = f'http://localhost:8888/api/v1/indicators/{symbol}.TW/latest'
        req = urllib.request.urlopen(url, timeout=10)
        data = json.loads(req.read())
        price = float(data.get('latest_close', 0))
        if price <= 0:
            continue
        if item.get('above') and price > item['above']:
            alerts.append(f'[警報] {name}({symbol}) {price:.1f} 突破上限 {item["above"]}')
        if item.get('below') and price < item['below']:
            alerts.append(f'[警報] {name}({symbol}) {price:.1f} 跌破下限 {item["below"]}')
        # Also check RSI extremes
        rsi = data.get('rsi_14')
        if rsi and rsi < 30:
            alerts.append(f'[RSI] {name}({symbol}) RSI={rsi:.1f} 超賣')
        elif rsi and rsi > 70:
            alerts.append(f'[RSI] {name}({symbol}) RSI={rsi:.1f} 超買')
    except:
        pass

if alerts:
    print('\n'.join(alerts))
PYEOF
)

# Only send if there are alerts
if [ -n "$ALERTS" ]; then
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" \
    --data-urlencode text="$ALERTS" > /dev/null 2>&1
  echo "$ALERTS"
fi
