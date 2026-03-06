#!/usr/bin/env bash
# OpenClaw host script: system-stats.sh
# Purpose: Unified system statistics (CPU, memory, disk, process count)
# Usage: system-stats.sh [--json] [--format brief|detailed]

set -euo pipefail

format="brief"
json_mode=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      json_mode=1
      shift
      ;;
    --format)
      format="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Collect stats
cpu_usage=$(ps aux | awk '{sum+=$3} END {print sum "%"}')
mem_total=$(vm_stat | grep "Pages free" | awk '{print $3}' | sed 's/.//')
mem_usage=$(memory_pressure 2>/dev/null | grep "System-wide memory free percentage" | awk '{print $5}' || echo "N/A")
disk=$(df -h / | tail -1 | awk '{print $5, $4, $3}')
proc_count=$(ps aux | wc -l)

if [[ $json_mode -eq 1 ]]; then
  cat <<EOJSON
{
  "cpu_usage": "$cpu_usage",
  "memory_free_pages": "$mem_total",
  "memory_pressure": "$mem_usage",
  "disk_usage": "$disk",
  "process_count": $proc_count,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOJSON
else
  cat <<EOTEXT
System Statistics ($(date '+%Y-%m-%d %H:%M:%S'))
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CPU Usage:     $cpu_usage
Memory Pressure: $mem_usage
Disk Usage:    $disk
Processes:     $proc_count
EOTEXT
fi
