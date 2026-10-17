#!/usr/bin/env bash
# Phase B — off-peak full embed resume (all 5 units, higher concurrency).
# Run ON caselaw worker i-000115b19219bb766 (cron 20:00 IST).
set -uo pipefail

log() { echo "[$(date -Is)] $*"; }

log "=== EMBED OFF-PEAK FULL RESUME (5 units, EMBED_CONCURRENCY=10, EMBED_BATCH=200) ==="

OFFPEAK_DROPIN='[Service]
Environment=EMBED_CONCURRENCY=10
Environment=EMBED_BATCH=200
Environment=EMBED_HC_MAX_ROWS=200000
Environment=EMBED_DC_MAX_ROWS=120000
Environment=RDS_STATEMENT_TIMEOUT_MS=120000
'

for shard in 0 1 2; do
  mkdir -p "/etc/systemd/system/nyv-caselaw-embed-loop@${shard}.service.d"
  printf '%s\n' "$OFFPEAK_DROPIN" > "/etc/systemd/system/nyv-caselaw-embed-loop@${shard}.service.d/offpeak.conf"
  rm -f "/etc/systemd/system/nyv-caselaw-embed-loop@${shard}.service.d/throttle.conf"
done

mkdir -p /etc/systemd/system/nyv-caselaw-embed-dc.service.d
printf '%s\n' "$OFFPEAK_DROPIN" > /etc/systemd/system/nyv-caselaw-embed-dc.service.d/offpeak.conf
rm -f /etc/systemd/system/nyv-caselaw-embed-dc.service.d/throttle.conf 2>/dev/null || true

mkdir -p /etc/systemd/system/nyv-embed-statutes-loop.service.d
printf '%s\n' '[Service]
Environment=EMBED_CONCURRENCY=6
Environment=EMBED_BATCH=150
Environment=RDS_STATEMENT_TIMEOUT_MS=120000
' > /etc/systemd/system/nyv-embed-statutes-loop.service.d/offpeak.conf

rm -f /etc/systemd/system/nyv-caselaw-embed-loop@2.service.d/zz-year-window.conf 2>/dev/null || true
log "  shard 2: removed zz-year-window.conf (full hc:s2of3 backlog during accelerate GO)"

systemctl daemon-reload

for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@1 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc nyv-embed-statutes-loop; do
  systemctl enable "$u" 2>/dev/null || true
  systemctl restart "$u" 2>/dev/null || systemctl start "$u" 2>/dev/null || log "start failed $u"
  log "  $u -> $(systemctl is-active "$u" 2>/dev/null || echo inactive)"
done

log "=== ACTIVE EMBED UNITS (off-peak) ==="
systemctl is-active nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@1 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc nyv-embed-statutes-loop 2>/dev/null || true
pgrep -af embed-corpus.mjs | head -12 || log "no embed pids yet"
curl -sS -m 15 -o /dev/null -w "nyayasearch healthz http=%{http_code}\n" https://nyayasearch.nyayasiddhi.online/healthz
log "=== OFF-PEAK FULL RESUME COMPLETE ==="
