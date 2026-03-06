#!/usr/bin/env bash
# OpenClaw host script: taiwan-stock-backup.sh
# Purpose: Taiwan Stock MVP database backup management
# Usage: taiwan-stock-backup.sh {backup|restore|list|cleanup}

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/Users/rexmacmini/backups/taiwan-stock}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

action="${1:-list}"

case "$action" in
  backup)
    mkdir -p "$BACKUP_DIR"
    backup_file="$BACKUP_DIR/stock_db_$(date +%Y%m%d_%H%M%S).sql.gz"
    echo "Backing up to $backup_file..."
    
    docker exec taiwan-stock-postgres pg_dump -U postgres stock_db | gzip > "$backup_file"
    
    if [[ -f "$backup_file" ]]; then
      size=$(du -h "$backup_file" | awk '{print $1}')
      echo "✓ Backup complete: $size"
    else
      echo "✗ Backup failed"
      exit 1
    fi
    ;;
  
  restore)
    backup_file="${2:-}"
    if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
      echo "Usage: taiwan-stock-backup.sh restore <backup_file>" >&2
      exit 1
    fi
    
    echo "⚠️  WARNING: This will restore from $backup_file"
    echo "Proceeding..."
    
    zcat "$backup_file" | docker exec -i taiwan-stock-postgres psql -U postgres stock_db
    echo "✓ Restore complete"
    ;;
  
  list)
    echo "=== Backups ==="
    if [[ -d "$BACKUP_DIR" ]]; then
      ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | awk '{print $9, "(" $5 ")"}'  || echo "No backups found"
    else
      echo "Backup directory not found: $BACKUP_DIR"
    fi
    ;;
  
  cleanup)
    echo "Cleaning up backups older than $RETENTION_DAYS days..."
    find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete -print 2>/dev/null || echo "No files to clean"
    echo "✓ Cleanup complete"
    ;;
  
  *)
    echo "Usage: taiwan-stock-backup.sh {backup|restore|list|cleanup}" >&2
    exit 1
    ;;
esac
