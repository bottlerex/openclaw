#!/bin/bash
# OpenClaw Update Checker
# Compares local vs remote image versions

CONTAINER_NAME="openclaw-agent"
REGISTRY="ghcr.io"
IMAGE_NAME="openclaw/openclaw"
TAG="main"
IMAGE_REPO="${REGISTRY}/${IMAGE_NAME}:${TAG}"
LOG_FILE="/tmp/openclaw-version-check.log"

log() {
  local timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

# Get local image ID (current)
get_local_image_id() {
  docker inspect "$IMAGE_REPO" --format='{{.ID}}' 2>/dev/null || echo "unknown"
}

# Get remote image ID (latest from registry)
get_remote_image_id() {
  # Try using docker manifest inspect (requires Docker 20.10+)
  docker manifest inspect "$IMAGE_REPO" 2>/dev/null | grep -o '"sha256:[a-f0-9]*"' | head -1 | tr -d '"' || echo "unknown"
}

# Get image created date
get_image_date() {
  docker inspect "$IMAGE_REPO" --format='{{.Created}}' 2>/dev/null | cut -d'T' -f1 || echo "unknown"
}

# Check for available updates
check_updates() {
  log "=== OpenClaw Update Check ==="

  local local_id=$(get_local_image_id)
  local remote_id=$(get_remote_image_id)
  local local_date=$(get_image_date)

  log "Local image:  ${local_id:0:12}... (created: $local_date)"
  log "Remote image: ${remote_id:0:12}... (latest)"

  # Compare
  if [ "$local_id" = "$remote_id" ]; then
    log "✅ Image is up to date"
    return 0
  else
    log "⚠️  Update available!"
    log "Action: Run 'docker-compose pull && docker-compose up -d' to update"
    return 1
  fi
}

# Check GitHub releases for changelog
check_github_releases() {
  log ""
  log "=== Recent GitHub Releases ==="

  # Fetch latest 3 releases from GitHub API
  curl -s "https://api.github.com/repos/openclaw/openclaw/releases?per_page=3" 2>/dev/null | \
    jq -r '.[] | "📌 \(.name) (\(.published_at | split("T")[0]))"' || log "⚠️  Could not fetch GitHub releases"
}

# Main
log "Starting OpenClaw update check..."
log "Repository: $IMAGE_REPO"
log ""

check_updates
check_github_releases

log ""
log "Check completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
