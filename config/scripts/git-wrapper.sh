#!/usr/bin/env bash
# OpenClaw helper: git-wrapper.sh
# Purpose: Execute git commands in arbitrary directories (supports -C)
# Usage: git-wrapper.sh [options] [git-args...]
#   -d, --dir DIR    Target directory (if using -C style)
#   --cwd DIR        Alternative to -C
#   --                Separator before git arguments

set -euo pipefail

# 使用正確的 git 路徑
GIT_CMD="$(/usr/bin/which git || echo '/usr/bin/git')"

target_dir=""
git_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dir|--cwd)
      target_dir="$2"
      shift 2
      ;;
    --)
      shift
      git_args=("$@")
      break
      ;;
    *)
      git_args+=("$1")
      shift
      ;;
  esac
done

# 安全檢查：禁止危險命令
for arg in "${git_args[@]}"; do
  if [[ "$arg" =~ ^(clone|push|force|--force|-f)$ ]]; then
    echo "❌ Denied: Git command '${arg}' not allowed in OpenClaw sandbox" >&2
    exit 1
  fi
done

# 執行 git（允許 -C 參數，但受 allowlist 控制）
if [[ -n "$target_dir" ]]; then
  "$GIT_CMD" -C "$target_dir" "${git_args[@]}"
else
  "$GIT_CMD" "${git_args[@]}"
fi
