#!/bin/sh
# Post-deploy verify for Job 297 fixes. Positive control: grep -c cannot be empty.

echo "=== health ==="
curl -sS -m 20 -o /dev/null -w "local=%{http_code}\n" http://localhost:5000/health
curl -sS -m 20 -o /dev/null -w "public=%{http_code}\n" https://api.nyayasiddhi.online/health

echo "=== markers in running image (must be >=1) ==="
echo -n "explicit_fast_alias="
docker exec nyv-gateway grep -c "isPartnerExplicitFastAlias" /app/src/utils/jrx-partner-platform.ts
echo -n "scale_cot_capture="
docker exec nyv-gateway grep -c "scaleCoTAfterCaptureFailure" /app/src/routes/jrx-orchestration-routes.ts
echo -n "capture_failed_stamp="
docker exec nyv-gateway grep -c "__queenCotCaptureFailed = true" /app/src/orchestration/jrx-queen-orchestrator.ts

echo "=== container ==="
docker ps --format "{{.Names}} {{.Status}}" | grep nyv-gateway

CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
KLEN=`printf %s "$K" | wc -c`
echo "control: nsp_key_len=$KLEN"
if [ "$KLEN" -lt 16 ]; then echo "PROBE BROKEN: no NSP key"; exit 3; fi

echo "=== live legal-draft-fast on public host ==="
curl -sS -m 120 -o /tmp/ff -w "http=%{http_code} time=%{time_total}s\n" \
  -X POST \
  -H "X-API-Key: $K" \
  -H "X-NYV-Platform: nsp" \
  -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Draft a two-paragraph Written Statement for recovery of money. Keep it short.","taskType":"legal-draft-fast","jurisdiction":"IN"}' \
  https://api.nyayasiddhi.online/api/jrx/orchestrate
echo "bytes=`wc -c < /tmp/ff`"
grep -o '"path":"[a-z-]*"' /tmp/ff | head -3
grep -o 'QUALITY_ENVELOPE_FAILED' /tmp/ff | head -1 || echo "no_QUALITY_ENVELOPE_FAILED"
grep -o '"missingMandatory":\[[^]]*\]' /tmp/ff | head -1
head -c 220 /tmp/ff
echo
