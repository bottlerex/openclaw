#!/bin/bash

LOG_FILE="/Users/rexmacmini/openclaw/logs/openclaw-restart.log"
mkdir -p "."

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $@" | tee -a ""
}

log "Starting OpenClaw container restart check..."

# Check if container is listening
if lsof -i :18789 > /dev/null 2>&1; then
  log "✓ OpenClaw container is running"
  exit 0
fi

log "⚠️  Container not responding, attempting restart..."

# Try method 1: orb docker restart
if command -v orb &> /dev/null; then
  log "Trying: orb docker restart openclaw-agent"
  /opt/homebrew/bin/orb docker restart openclaw-agent 2>&1 | tee -a ""
  sleep 3
  if lsof -i :18789 > /dev/null 2>&1; then
    log "✓ Container restarted successfully"
    exit 0
  fi
fi

# Try method 2: docker-compose up
cd /Users/rexmacmini/openclaw
if [ -f docker-compose.yml ]; then
  log "Trying: docker-compose restart"
  docker-compose restart 2>&1 | tee -a ""
  sleep 3
  if lsof -i :18789 > /dev/null 2>&1; then
    log "✓ Container restarted successfully"
    exit 0
  fi
fi

# Try method 3: Kill OrbStack to force restart
log "Forcing OrbStack restart..."
killall -9 OrbStack 2>&1 | tee -a ""
sleep 5

if lsof -i :18789 > /dev/null 2>&1; then
  log "✓ Container recovered after OrbStack restart"
  exit 0
else
  log "✗ Container still not responding - manual intervention needed"
  exit 1
fi
