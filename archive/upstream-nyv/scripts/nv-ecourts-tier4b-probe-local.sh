#!/usr/bin/env bash
# NV-ECOURTS-TIER4B-PROBE-001 — local smoke for portal tier (flag off = honest 503).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NYV_F_ECOURTS_PORTAL_FETCH="${NYV_F_ECOURTS_PORTAL_FETCH:-0}"

echo "=== Tier-4b probe (NYV_F_ECOURTS_PORTAL_FETCH=$NYV_F_ECOURTS_PORTAL_FETCH) ==="

node --input-type=module <<'NODE'
import {
  isEcourtsPortalFetchEnabled,
  attemptEcourtsPortalFetch,
} from './src/services/jrx-ecourts-portal-fetch.ts';
import {
  enqueueEcourtsPortalJob,
  clearEcourtsPortalJobsForTests,
} from './src/services/jrx-ecourts-tier4b-worker.ts';

const enabled = isEcourtsPortalFetchEnabled();
console.log('portal_enabled', enabled);

const attempt = await attemptEcourtsPortalFetch({ cnr: 'TSWL000000742024' });
console.log('sync_attempt_kind', attempt.kind);
if (attempt.kind === 'attempted') {
  console.log('sync_attempt_reason_len', attempt.reason.length);
}

clearEcourtsPortalJobsForTests();
const queued = enqueueEcourtsPortalJob({ cnr: 'TSWL000000742024' });
console.log('enqueue_result', queued ? 'jobId' : 'null');
NODE

echo "=== probe done ==="
