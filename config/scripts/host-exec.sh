#!/usr/bin/env bash
# Execute a command on the Mac mini host via SSH
# Usage (from container):
#   /home/node/.openclaw/scripts/host-exec.sh "git -C ~/projects/taiwan-stock-mvp log --oneline -5"
#   /home/node/.openclaw/scripts/host-exec.sh "claude -p 'hello' --max-turns 1"

set -euo pipefail

HOST_USER="${OC_BRIDGE_USER:-rexmacmini}"
HOST_ADDR="${OC_BRIDGE_HOST:-host.docker.internal}"

if [ $# -eq 0 ]; then
  echo "Usage: host-exec.sh <command>"
  exit 1
fi

exec ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
  "${HOST_USER}@${HOST_ADDR}" \
  "$@"
