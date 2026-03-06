#!/usr/bin/env bash
# OpenClaw host script: log-checker.sh
# Purpose: Unified log aggregation and search
# Usage: log-checker.sh {docker|system|all} [--service NAME] [--tail LINES] [--grep PATTERN]

set -euo pipefail

source="${1:-all}"
service="${3:-}"
tail_lines="${5:-50}"
grep_pattern="${7:-}"

case "$source" in
  docker)
    if [[ -z "$service" ]]; then
      echo "=== Docker Logs (all containers) ==="
      docker logs --tail $tail_lines $(docker ps -q) 2>/dev/null | tail -$tail_lines
    else
      echo "=== Docker Logs ($service) ==="
      docker logs --tail $tail_lines "$service" 2>/dev/null || echo "Container not found: $service"
    fi
    ;;
  
  system)
    echo "=== System Logs (last $tail_lines lines) ==="
    log show --predicate 'eventMessage contains[c] "error" OR eventMessage contains[c] "warning"' --last 1h 2>/dev/null | tail -$tail_lines || echo "Logs not available"
    ;;
  
  all)
    echo "=== OpenClaw Related Logs ==="
    docker logs --tail $((tail_lines / 2)) openclaw-agent 2>/dev/null || echo "OpenClaw logs not available"
    echo ""
    echo "=== System Events ==="
    log show --predicate 'eventMessage contains[c] "openclaw"' --last 1h 2>/dev/null | tail -$((tail_lines / 2)) || echo "System logs not available"
    ;;
  
  *)
    echo "Usage: log-checker.sh {docker|system|all} [--service NAME] [--tail LINES]" >&2
    exit 1
    ;;
esac

if [[ -n "$grep_pattern" ]]; then
  echo ""
  echo "=== Filtered by: $grep_pattern ==="
  # Re-run with grep
  case "$source" in
    docker)
      docker logs --tail 500 "$service" 2>/dev/null | grep -i "$grep_pattern" || echo "No matches"
      ;;
  esac
fi
