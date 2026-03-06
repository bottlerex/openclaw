#!/usr/bin/env bash
# OpenClaw helper: disk-info.sh
# Purpose: Query disk usage with proper formatting
# Usage: disk-info.sh [options]
#   --all       Show all filesystems (df -a)
#   --inode     Show inode usage (df -i)
#   --human     Human-readable format (df -h) [default]
#   --path PATH Check specific path

set -euo pipefail

# 使用正確的 df 路徑
DF_CMD="$(/usr/bin/which df || echo '/bin/df')"

format_mode="human"
path_target="/"
all_fs=""
inode_mode=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      all_fs="-a"
      shift
      ;;
    --inode)
      inode_mode="-i"
      shift
      ;;
    --human)
      format_mode="human"
      shift
      ;;
    --path)
      path_target="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$format_mode" == "human" ]]; then
  "$DF_CMD" -h $all_fs $inode_mode "$path_target"
else
  "$DF_CMD" $all_fs $inode_mode "$path_target"
fi
