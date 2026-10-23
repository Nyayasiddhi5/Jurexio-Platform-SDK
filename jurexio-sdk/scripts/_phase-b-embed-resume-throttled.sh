#!/usr/bin/env bash
# Phase B B6 — throttled embed resume (1-2 HC shards only; CNR-safe)
# Run ON caselaw worker i-000115b19219bb766 via SSM.
set -uo pipefail

echo "=== EMBED THROTTLED RESUME (2 HC shards) ==="

# Ensure DC + shard-2 + statutes stay stopped
for u in jrx-caselaw-embed-loop@2 jrx-caselaw-embed-dc jrx-embed-statutes-loop; do
  systemctl stop "$u" 2>/dev/null || true
  systemctl disable "$u" 2>/dev/null || true
  echo "  $u -> stopped/disabled"
done

# Throttled HC shards 0+1 with reduced concurrency via drop-in
for shard in 0 1; do
  mkdir -p "/etc/systemd/system/jrx-caselaw-embed-loop@${shard}.service.d"
  tee "/etc/systemd/system/jrx-caselaw-embed-loop@${shard}.service.d/throttle.conf" >/dev/null <<'DROPIN'
[Service]
Environment=EMBED_CONCURRENCY=4
Environment=EMBED_BATCH=100
Environment=EMBED_HC_MAX_ROWS=50000
DROPIN
  systemctl daemon-reload
  systemctl enable "jrx-caselaw-embed-loop@${shard}" 2>/dev/null || true
  systemctl start "jrx-caselaw-embed-loop@${shard}" 2>/dev/null || echo "start failed shard $shard"
  echo "  jrx-caselaw-embed-loop@${shard} -> $(systemctl is-active jrx-caselaw-embed-loop@${shard} 2>/dev/null || echo inactive)"
done

echo "=== ACTIVE EMBED UNITS ==="
systemctl is-active jrx-caselaw-embed-loop@0 jrx-caselaw-embed-loop@1 jrx-caselaw-embed-loop@2 jrx-caselaw-embed-dc jrx-embed-statutes-loop 2>/dev/null || true
pgrep -af embed-corpus.mjs | head -10 || echo "no embed pids yet"

echo "=== POST-RESUME HEALTH ==="
curl -sS -m 15 -o /dev/null -w "nyayasearch healthz http=%{http_code}\n" https://nyayasearch.jurexio.com/healthz
