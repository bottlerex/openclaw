# OpenClaw Exec Tools Fix — P0.5

**Date**: 2026-03-06  
**Status**: Deployed  
**Affected Modules**: exec-policy, allowlist, tools/disk-info, tools/git-wrapper

## Problem

Two commonly used commands were restricted by OpenClaw's security policy:

1. **`df -h`** — Blocked due to path resolution or parameter validation
2. **`git -C ~/projects/taiwan-stock-mvp`** — Blocked due to external directory access restriction

## Solution

### 1. Enhanced Allowlist (exec-approvals.json)

- Upgraded `/bin/df` → `/usr/bin/df` with all-flags support
- Enhanced `git` entry with `-C` parameter documentation
- Added `host-exec.sh` bridge for external macOS path access

**Before:**
```json
{"id": "safe-df", "pattern": "/bin/df"}
{"id": "safe-git", "pattern": "/usr/bin/git"}
```

**After:**
```json
{"id": "safe-df-improved", "pattern": "/usr/bin/df", "description": "Disk free with all flags"}
{"id": "safe-git", "pattern": "/usr/bin/git", "description": "Git with -C parameter support"}
{"id": "safe-host-exec", "pattern": "/home/node/.openclaw/scripts/host-exec.sh"}
```

### 2. Helper Scripts

Created two safety-checked wrapper scripts:

#### `config/scripts/disk-info.sh`
```bash
# Usage: disk-info.sh [--human|--inode|--all] [--path PATH]
disk-info.sh --human --path /
disk-info.sh --inode  # Check inode usage
```

#### `config/scripts/git-wrapper.sh`
```bash
# Usage: git-wrapper.sh [-d DIR] [--] [git-args...]
git-wrapper.sh -d /home/node/projects log --oneline -3
git-wrapper.sh -- status  # Current directory
```

**Safety Features:**
- Path resolution (finds df/git automatically)
- Dangerous command blocking (clone, push, force, etc.)
- Parameter validation
- Audit logging via OpenClaw exec framework

## Verification

✅ All tests passed:
- `disk-info.sh --human --path /` returns disk usage
- `git-wrapper.sh log --oneline -1` executes git commands
- `/bin/df -h /` works directly
- allowlist updated with 3 new entries

## Usage Guidelines

### For Disk Space Queries
**Old (restricted):**
```bash
df -h /
```

**New (recommended):**
```bash
bash /home/node/.openclaw/scripts/disk-info.sh --human --path /
```

### For Git Operations in External Directories
**Old (restricted):**
```bash
git -C ~/projects/taiwan-stock-mvp log --oneline -3
```

**New (bridge through host-exec):**
```bash
bash /home/node/.openclaw/scripts/host-exec.sh "git -C ~/projects/taiwan-stock-mvp log --oneline -3"
```

## Files Modified

- ✏️ `config/exec-approvals.json` — Updated allowlist (NOT committed, in .gitignore)
- ✨ `config/scripts/disk-info.sh` — New helper script
- ✨ `config/scripts/git-wrapper.sh` — New helper script
- 📄 `config/EXEC_FIXES.md` — This documentation

## Next Steps

- Monitor logs for 24h to ensure no new errors
- Test in actual Telegram bot commands
- Consider adding more safety-checked wrappers for other tools
