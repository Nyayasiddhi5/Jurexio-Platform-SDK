#!/bin/sh
# NV-JOB297-RCA — reconstruct Job 297 on the host Pro actually calls.
# Pro NV_API_BASE_URL=https://api.nyayasiddhi.online  (ALB → nysdev :80)
# Fingerprint: ~2026-08-17T05:37Z  agent=drafting-specialist
#              body QUALITY_ENVELOPE_FAILED  missing: ["cot"]
# Control: later doc-draft (task 356) completed — a now-probe can pass.

echo "=== 1. IDENTITY: localhost:5000 vs public ALB (what Pro hits) ==="
echo -n "localhost_health="
curl -sS -m 15 -o /tmp/h_local -w "%{http_code} t=%{time_total}s\n" http://localhost:5000/health
echo -n "public_health="
curl -sS -m 15 -o /tmp/h_pub -w "%{http_code} t=%{time_total}s\n" https://api.nyayasiddhi.online/health
echo -n "public_via_80="
curl -sS -m 15 -o /tmp/h80 -w "%{http_code} t=%{time_total}s\n" -H "Host: api.nyayasiddhi.online" http://127.0.0.1:80/health

echo "=== 2. LIVE FLAGS + WHICH FIXES ARE IN THE RUNNING IMAGE ==="
docker exec nyv-gateway printenv NYV_NSP_COUNSEL_QUEEN NYV_ECOSYSTEM_BEST_OUTCOME NYV_ALLOW_NSP_NYM_LEAN NODE_ENV
echo -n "collective_cot_fix="
docker exec nyv-gateway grep -c "NV-QUEEN-COT-COLLECTIVE-001" /app/src/orchestration/jrx-queen-orchestrator.ts
echo -n "specialist_scaleoff="
docker exec nyv-gateway grep -c "NV-QE-MC-HONEST-001" /app/src/routes/jrx-orchestration-routes.ts
echo -n "queen_fallback_scaleoff="
docker exec nyv-gateway grep -c "NV-QE-MC-FALLBACK-001" /app/src/routes/jrx-orchestration-routes.ts
echo -n "counsel_queen_veto="
docker exec nyv-gateway grep -c "wantsNspCounselQueen(req) && isPartnerCounselOrDraftTask" /app/src/utils/jrx-partner-platform.ts
echo -n "explicit_fast_alias="
docker exec nyv-gateway grep -c "isPartnerExplicitFastAlias" /app/src/utils/jrx-partner-platform.ts

echo "=== 3. WINDOW 05:30-05:45Z — AdaptiveRouter (path + require signals) ==="
docker logs --since "2026-08-17T05:30:00Z" --until "2026-08-17T05:45:00Z" nyv-gateway 2>&1 \
  | grep "AdaptiveRouter decision" | tail -20

echo "=== 4. WINDOW — QUALITY / missing cot / CoT capture / drafting-specialist ==="
docker logs --since "2026-08-17T05:30:00Z" --until "2026-08-17T05:45:00Z" nyv-gateway 2>&1 \
  | grep -iE "QUALITY_ENVELOPE|mandatory steps missing|CoT capture failed|drafting-specialist|queenCotApplied|path-ema|Queen Orchestrator error" \
  | tail -40

echo "=== 5. WINDOW — HTTP-ish 500 / INTERNAL_ERROR ==="
docker logs --since "2026-08-17T05:30:00Z" --until "2026-08-17T05:45:00Z" nyv-gateway 2>&1 \
  | grep -iE '"level":"error"|INTERNAL_ERROR|status.:500' | tail -25

echo "=== 6. NGINX access around 05:37 (ALB → :80) ==="
docker logs --since "2026-08-17T05:30:00Z" --until "2026-08-17T05:45:00Z" nyv-console 2>&1 \
  | grep -E "orchestrate|legal-draft|/sdk/" | tail -20
