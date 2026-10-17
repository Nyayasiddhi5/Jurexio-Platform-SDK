#!/usr/bin/env bash
# NV-CASCADE-TRACE-001 — read the real cascade/hedge log lines so we can see
# per-request which model was attempted, which won, and what was wasted.
set -uo pipefail
CID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
[ -z "$CID" ] && { echo "gateway container not found"; exit 0; }
LOG=/tmp/gw2.log
docker logs --tail 8000 "$CID" >"$LOG" 2>&1

echo "=== raw CASCADE lines (last 30, truncated) ==="
grep -iE 'cascade' "$LOG" | tail -30 | cut -c1-300

echo
echo "=== raw hedge lines (last 20) ==="
grep -iE 'hedge' "$LOG" | tail -20 | cut -c1-300

echo
echo "=== 'Fallback Model' lines ==="
grep -i 'Fallback Model' "$LOG" | tail -6 | cut -c1-300

echo
echo "=== embeddings per orchestrate request ==="
E=$(grep -c 'gemini-embedding' "$LOG"); R=$(grep -cE 'POST /api/jrx/orchestrate' "$LOG")
echo "embeddings=$E requests=$R  ratio=$(python3 -c "print(round($E/max($R,1),2))")"
echo
echo "=== embedding call context (what triggers them) ==="
grep -E 'gemini-embedding' "$LOG" | tail -8 | cut -c1-260

echo
echo "=== which AWS identity does the app use for Bedrock? (names only) ==="
CANON="/opt/Nyayavigya/secrets/.env.production"
grep -oE '^(AWS_REGION|AWS_BEDROCK_REGION|NYV_BEDROCK_[A-Z_]*|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|NYV_ROUTER_BEDROCK_FIRST)=' "$CANON" 2>/dev/null | sort -u
echo "(presence only, no values)"
