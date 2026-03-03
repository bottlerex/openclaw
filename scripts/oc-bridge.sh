#!/usr/bin/env bash
# OpenClaw → Host Bridge
# Runs oc CLI commands on the Mac mini host via SSH.
# Designed to be called from inside the OpenClaw container.
#
# Usage (from container):
#   /home/node/.openclaw/scripts/oc-bridge.sh sessions.list
#   /home/node/.openclaw/scripts/oc-bridge.sh chat.send "hello from bridge"
#   /home/node/.openclaw/scripts/oc-bridge.sh node.list
#
# The script SSHs to the host and runs the oc CLI with full PATH.

set -euo pipefail

HOST_USER="${OC_BRIDGE_USER:-rexmacmini}"
HOST_ADDR="${OC_BRIDGE_HOST:-host.docker.internal}"
OC_PATH="/Users/${HOST_USER}/openclaw/scripts/oc"

if [ $# -eq 0 ]; then
  echo "Usage: oc-bridge.sh <command> [args...]"
  echo "Example: oc-bridge.sh sessions.list"
  exit 1
fi

exec ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
  "${HOST_USER}@${HOST_ADDR}" \
  "${OC_PATH}" "$@"
