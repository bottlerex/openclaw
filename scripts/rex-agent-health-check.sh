#!/bin/bash
# rex-agent Health Check & Monitoring
# Purpose: Verify all rex-agent components are healthy
# Runs: Every 30 minutes via cron

set -e

LOGFILE="${HOME}/.rex-agent-health.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
TOKEN=$(cat ~/.agentd-token)

echo "[$TIMESTAMP] Starting rex-agent health check..." >> $LOGFILE

# Check 1: mac-agentd process
if pgrep -f 'mac-agentd.cjs' > /dev/null; then
  echo "[$TIMESTAMP] ✓ mac-agentd process running" >> $LOGFILE
else
  echo "[$TIMESTAMP] ✗ mac-agentd process NOT running" >> $LOGFILE
  # Attempt restart
  cd /Users/rexmacmini/openclaw && nohup node mac-agentd.cjs > ~/.mac-agentd.log 2>&1 &
  echo "[$TIMESTAMP] ⚡ Restarted mac-agentd" >> $LOGFILE
fi

# Check 2: /shell/exec endpoint
SHELL_TEST=$(curl -s -X POST http://127.0.0.1:7777/shell/exec   -H "Authorization: Bearer $TOKEN"   -H 'Content-Type: application/json'   -d '{"command": "echo OK"}' | jq -r '.ok // "error"')

if [ "$SHELL_TEST" = "true" ]; then
  echo "[$TIMESTAMP] ✓ /shell/exec endpoint working" >> $LOGFILE
else
  echo "[$TIMESTAMP] ✗ /shell/exec endpoint failed" >> $LOGFILE
fi

# Check 3: openclaw Telegram status
if docker ps | grep -q openclaw-agent; then
  echo "[$TIMESTAMP] ✓ openclaw-agent container running" >> $LOGFILE
else
  echo "[$TIMESTAMP] ✗ openclaw-agent container NOT running" >> $LOGFILE
fi

# Check 4: Session Bridge (optional)
SESSION_TEST=$(curl -s http://localhost:7788/health 2>&1 | jq -r '.ok // "error"')
if [ "$SESSION_TEST" = "true" ]; then
  echo "[$TIMESTAMP] ✓ Session Bridge healthy" >> $LOGFILE
else
  echo "[$TIMESTAMP] ⚠ Session Bridge not responding (optional)" >> $LOGFILE
fi

# Check 5: Gemini API connectivity
if [ -n "$GEMINI_API_KEY" ]; then
  GEMINI_TEST=$(curl -s https://generativelanguage.googleapis.com/v1/models     -H "x-goog-api-key: $GEMINI_API_KEY" | jq -r '.models // "error"')
  if [ "$GEMINI_TEST" != "error" ]; then
    echo "[$TIMESTAMP] ✓ Gemini API accessible" >> $LOGFILE
  else
    echo "[$TIMESTAMP] ✗ Gemini API not accessible" >> $LOGFILE
  fi
else
  echo "[$TIMESTAMP] ⚠ GEMINI_API_KEY not set" >> $LOGFILE
fi

# Summary
SUMMARY="[$TIMESTAMP] Health check complete"
if grep -q '✗' <(tail -10 $LOGFILE); then
  SUMMARY="$SUMMARY - ⚠️  Some issues detected"
else
  SUMMARY="$SUMMARY - ✅ All systems healthy"
fi
echo "$SUMMARY" >> $LOGFILE
echo ""

# Send to Telegram if configured
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  HEALTH_STATUS=$(tail -1 $LOGFILE)
  curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"     -d "chat_id=$TELEGRAM_CHAT_ID&text=rex-agent: $HEALTH_STATUS" > /dev/null
fi
