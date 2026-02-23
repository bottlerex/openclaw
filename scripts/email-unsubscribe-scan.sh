#!/bin/bash
# Email Unsubscribe Scan — 每週促銷郵件分析
export PATH=$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:$PATH
CONTAINER="openclaw-agent"
ACCOUNT="rex.smart@gmail.com"
GOG_ENV="-e GOG_KEYRING_PASSWORD=openclaw2026"
BOT_TOKEN="8529641247:AAEKWoGZLPilF7C6L3IeO7dcLMKXwQ5nFp8"
CHAT_ID="150944774"

# Step 1: 列出本週促銷郵件
PROMO_RESULT=$(docker exec $GOG_ENV $CONTAINER gog -j gmail messages list "category:promotions newer_than:7d" --account "$ACCOUNT" 2>/dev/null)

# Step 2: 統計寄件者頻率
REPORT=$(echo "$PROMO_RESULT" | python3 -c "
import json, sys
from collections import Counter
try:
    data = json.load(sys.stdin)
    msgs = data.get('messages', [])
    total = len(msgs)
    senders = Counter()
    for msg in msgs:
        fr = msg.get('from', '')
        # Extract sender name
        name = fr.split('<')[0].strip().strip('\"')
        if not name:
            name = fr
        senders[name] += 1

    lines = [f'本週促銷郵件 {total} 封，來自 {len(senders)} 個寄件者']
    if senders:
        lines.append('頻率最高（建議退訂）:')
        for name, count in senders.most_common(5):
            lines.append(f'  - {name}: {count} 封')
    print('\n'.join(lines))
except:
    print('促銷郵件掃描失敗')
" 2>/dev/null)

# Step 3: 發送 Telegram
if [ -n "$REPORT" ]; then
  MSG="[退訂掃描] $(date +%m/%d)
$REPORT"
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" \
    --data-urlencode text="$MSG" \
    -d disable_notification=true > /dev/null 2>&1
  echo "$MSG"
fi
