#!/usr/bin/env bash
# NSP CNR peak hours — minimal embed load (HC shards 0+1, low concurrency).
# Run ON caselaw worker i-000115b19219bb766 (cron 10:00 IST).
set -uo pipefail

log() { echo "[$(date -Is)] $*"; }

log "=== EMBED PEAK-CNR THROTTLE (2 HC shards, EMBED_CONCURRENCY=2) ==="

for u in jrx-caselaw-embed-loop@2 jrx-caselaw-embed-dc jrx-embed-statutes-loop; do
  systemctl stop "$u" 2>/dev/null || true
  systemctl disable "$u" 2>/dev/null || true
  log "  $u -> stopped/disabled"
done

PEAK_DROPIN='[Service]
Environment=EMBED_CONCURRENCY=2
Environment=EMBED_BATCH=50
Environment=EMBED_HC_MAX_ROWS=10000
Environment=RDS_STATEMENT_TIMEOUT_MS=25000
'

for shard in 0 1; do
  mkdir -p "/etc/systemd/system/jrx-caselaw-embed-loop@${shard}.service.d"
  rm -f "/etc/systemd/system/jrx-caselaw-embed-loop@${shard}.service.d/offpeak.conf"
  printf '%s\n' "$PEAK_DROPIN" > "/etc/systemd/system/jrx-caselaw-embed-loop@${shard}.service.d/throttle.conf"
  systemctl daemon-reload
  systemctl enable "jrx-caselaw-embed-loop@${shard}" 2>/dev/null || true
  systemctl restart "jrx-caselaw-embed-loop@${shard}" 2>/dev/null || systemctl start "jrx-caselaw-embed-loop@${shard}" 2>/dev/null || log "start failed shard $shard"
  log "  jrx-caselaw-embed-loop@${shard} -> $(systemctl is-active jrx-caselaw-embed-loop@${shard} 2>/dev/null || echo inactive)"
done

# Clear off-peak drop-ins on stopped shards so a manual start does not inherit high concurrency during peak.
for shard in 2; do
  rm -f "/etc/systemd/system/jrx-caselaw-embed-loop@${shard}.service.d/offpeak.conf" "/etc/systemd/system/jrx-caselaw-embed-loop@${shard}.service.d/throttle.conf" 2>/dev/null || true
done

log "=== ACTIVE EMBED UNITS (peak) ==="
systemctl is-active jrx-caselaw-embed-loop@0 jrx-caselaw-embed-loop@1 jrx-caselaw-embed-loop@2 jrx-caselaw-embed-dc jrx-embed-statutes-loop 2>/dev/null || true
pgrep -af embed-corpus.mjs | head -10 || log "no embed pids yet"
curl -sS -m 15 -o /dev/null -w "nyayasearch healthz http=%{http_code}\n" https://nyayasearch.jurexio.com/healthz
log "=== PEAK THROTTLE COMPLETE ==="
