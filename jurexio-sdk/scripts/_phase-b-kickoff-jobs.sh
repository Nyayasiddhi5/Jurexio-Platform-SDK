#!/usr/bin/env bash
# Kick off corpus backfill jobs on caselaw worker — fire-and-forget (no monitoring).
# Profile: nsp-developer, ap-south-1, instance i-000115b19219bb766
set -euo pipefail

echo "=== CORPUS JOB KICKOFF $(date -u +%FT%TZ) ==="

# A2 — SC body FTS retry (~13,204 s3 rows; target >95% / 41,430+)
pkill -f backfill-sc-body-fts.mjs 2>/dev/null || true
if [ -f /opt/nyv/api/.sc-body-fts-checkpoint.json ]; then
  mv /opt/nyv/api/.sc-body-fts-checkpoint.json /opt/nyv/api/.sc-body-fts-checkpoint.json.bak-go
fi
nohup env SC_BODY_FTS_BATCH=25 SC_BODY_FTS_CONCURRENCY=1 \
  node /opt/nyv/api/backfill-sc-body-fts.mjs \
  >> /opt/nyv/logs/sc-body-fts-b2-retry.log 2>&1 &
echo "SC_FTS_PID=$!"

# A3 — HC body FTS pilot (25K cap; skip if combined script already running)
if pgrep -f backfill-hc-body-fts-pilot.mjs >/dev/null; then
  echo "HC_PILOT_ALREADY_RUNNING"
elif pgrep -f backfill-hc-dc-body-fts.mjs >/dev/null; then
  echo "HC_PILOT_VIA_COMBINED=$(pgrep -f backfill-hc-dc-body-fts.mjs)"
else
  nohup env HC_BODY_FTS_MAX_ROWS=25000 HC_BODY_FTS_BATCH=25 HC_BODY_FTS_CONCURRENCY=1 \
    node /opt/nyv/api/backfill-hc-body-fts-pilot.mjs \
    >> /opt/nyv/logs/hc-body-fts-pilot.log 2>&1 &
  echo "HC_PILOT_PID=$!"
fi

# A3 — DC body FTS pilot (ready; start when HC pilot completes or manually)
# Uncomment to start DC in parallel (heavier RDS load):
# nohup env DC_BODY_FTS_MAX_ROWS=25000 DC_BODY_FTS_BATCH=25 DC_BODY_FTS_CONCURRENCY=1 \
#   node /opt/nyv/api/backfill-dc-body-fts-pilot.mjs \
#   >> /opt/nyv/logs/dc-body-fts-pilot.log 2>&1 &
echo "DC_PILOT=deferred (run backfill-dc-body-fts-pilot.mjs after HC pilot)"

sleep 2
pgrep -af 'backfill-sc-body-fts|backfill-hc|backfill-dc|embed-corpus' || true
echo "=== KICKOFF COMPLETE ==="
