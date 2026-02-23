#!/bin/bash
# Email Cleanup Script — 自動清理促銷郵件 + 統計重要未讀 + Telegram 通知
export PATH=$HOME/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:$PATH
CONTAINER="openclaw-agent"
ACCOUNT="rex.smart@gmail.com"
GOG_ENV="-e GOG_KEYRING_PASSWORD=openclaw2026"
BOT_TOKEN="8529641247:AAEKWoGZLPilF7C6L3IeO7dcLMKXwQ5nFp8"
CHAT_ID="150944774"

# Step 1: 找出超過 3 天的未讀促銷郵件
PROMO_RESULT=$(docker exec $GOG_ENV $CONTAINER gog -j gmail messages list "is:unread category:promotions older_than:3d" --account "$ACCOUNT" 2>/dev/null)
PROMO_IDS=$(echo "$PROMO_RESULT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    ids = [msg['id'] for msg in data.get('messages', [])]
    print(' '.join(ids))
except: pass
" 2>/dev/null)

CLEANED=0
if [ -n "$PROMO_IDS" ]; then
  RESULT=$(docker exec $GOG_ENV $CONTAINER gog gmail batch modify $PROMO_IDS --add TRASH --remove INBOX --force --account "$ACCOUNT" 2>&1)
  CLEANED=$(echo "$RESULT" | python3 -c "import sys; s=sys.stdin.read(); print(s.split()[1] if 'Modified' in s else 0)" 2>/dev/null || echo "0")
fi

# Step 2: 統計重要未讀
IMPORTANT_RESULT=$(docker exec $GOG_ENV $CONTAINER gog -j gmail messages list "is:unread -category:promotions -category:social" --account "$ACCOUNT" 2>/dev/null)
IMPORTANT_COUNT=$(echo "$IMPORTANT_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('messages',[])))" 2>/dev/null || echo "0")

# Step 3: 重要郵件標題 (最多 5 封)
IMPORTANT_TITLES=""
if [ "$IMPORTANT_COUNT" -gt 0 ] 2>/dev/null; then
  IMPORTANT_TITLES=$(echo "$IMPORTANT_RESULT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for msg in data.get('messages', [])[:5]:
    fr = msg.get('from','').split('<')[0].strip()
    subj = msg.get('subject','')
    print(f'  - {fr}: {subj}')
" 2>/dev/null)
fi

# Step 4: 組裝訊息
MSG="[郵件] 重要${IMPORTANT_COUNT}封 清理${CLEANED}封"
if [ -n "$IMPORTANT_TITLES" ]; then
  MSG="$MSG
$IMPORTANT_TITLES"
fi

# Step 5: 發送到 Telegram
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d chat_id="$CHAT_ID" \
  --data-urlencode text="$MSG" \
  -d disable_notification=true > /dev/null 2>&1

echo "$MSG"
