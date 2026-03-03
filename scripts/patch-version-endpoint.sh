#!/bin/bash
# Patch OpenClaw gateway to expose /version and /health HTTP endpoints
# The Control UI SPA catches all HTTP requests by default, blocking probe endpoints.
# This patch adds /version, /health, /healthz, /ready, /readyz to the exclusion list.
#
# Usage: docker exec openclaw-agent sh /app/scripts/patch-version-endpoint.sh
# Then:  docker restart openclaw-agent

set -e
cd /app/dist

PATCHED=0

for f in gateway-cli-*.js; do
  [ -f "$f" ] || continue

  # Skip already-patched files
  if grep -q 'pathname === "/version"' "$f" 2>/dev/null; then
    echo "[skip] $f already patched"
    continue
  fi

  # Skip backup files
  [[ "$f" == *.bak ]] && continue

  # Backup
  cp "$f" "${f}.bak"

  # Patch 1: Add endpoint exclusions to Control UI handler
  sed -i '/if (pathname === "\/api" || pathname.startsWith("\/api\/")) return false;/a\
\t\tif (pathname === "\/version" || pathname === "\/health" || pathname === "\/healthz" || pathname === "\/ready" || pathname === "\/readyz") return false;' "$f"

  # Patch 2: Add /version JSON handler before probe handler
  sed -i 's|if (handleGatewayProbeRequest(req, res, requestPath)) return;|if (requestPath === "/version") { try { const bi = JSON.parse(fs.readFileSync("/app/dist/build-info.json", "utf8")); sendJson(res, 200, bi); } catch(e) { sendJson(res, 200, {version:"unknown",error:String(e)}); } return; }\n\t\t\tif (handleGatewayProbeRequest(req, res, requestPath)) return;|' "$f"

  echo "[ok] patched $f"
  PATCHED=$((PATCHED + 1))
done

# Clear Node.js compile cache
rm -rf /tmp/node-compile-cache* 2>/dev/null

echo "Done. Patched $PATCHED file(s). Restart container to apply."
