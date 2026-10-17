#!/usr/bin/env bash
# Emergency re-pause all embed units (CNR degradation)
set -uo pipefail
echo "=== EMBED EMERGENCY PAUSE ==="
for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@1 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc nyv-embed-statutes-loop; do
  systemctl stop "$u" 2>/dev/null || true
  systemctl disable "$u" 2>/dev/null || true
  echo "  $u -> stopped"
done
pkill -f embed-corpus.mjs 2>/dev/null || true
sleep 2
pgrep -af embed-corpus.mjs || echo "no embed pids"
echo "=== PAUSE COMPLETE ==="
