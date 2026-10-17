#!/bin/sh
# Correlate the 05:37 500 with request 0a8671d0 / b7a9c3e1.

echo "=== byte-count of the known envelope body (must be 193) ==="
python3 -c 's="{\"success\":false,\"data\":null,\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"NYV-QUALITY-ENVELOPE-001: mandatory steps missing: cot\",\"details\":{\"code\":\"QUALITY_ENVELOPE_FAILED\",\"missing\":[\"cot\"]}}}"; print(len(s), s)'

echo "=== request 0a8671d0 (AdaptiveRouter 05:34:02) ==="
docker logs --since "2026-08-17T05:33:50Z" --until "2026-08-17T05:38:10Z" nyv-gateway 2>&1 \
  | grep "0a8671d0-df8f-428a-8113-ac0ea362f580" | grep -oE '"message":"[^"]+"|"path":"[^"]+"|"agentKey":"[^"]+"|"taskType":"[^"]+"|"queenCotApplied":[^,]+|"latencyMs":[0-9]+|"success":[^,]+|"requireCoT":[^,]+' | head -40

echo "=== request b7a9c3e1 (AdaptiveRouter 05:30:25) ==="
docker logs --since "2026-08-17T05:30:00Z" --until "2026-08-17T05:34:10Z" nyv-gateway 2>&1 \
  | grep "b7a9c3e1-2f6d-4b6a-8ae7-2b36de3edac4" | grep -oE '"message":"[^"]+"|"path":"[^"]+"|"agentKey":"[^"]+"|"taskType":"[^"]+"|"queenCotApplied":[^,]+|"latencyMs":[0-9]+|"success":[^,]+' | head -40

echo "=== Auto-selected / agent around those times ==="
docker logs --since "2026-08-17T05:30:00Z" --until "2026-08-17T05:38:00Z" nyv-gateway 2>&1 \
  | grep -iE "Auto-selected agent|agentKey|taskType=|legal-draft" | tail -30

echo "=== Queen complete vs envelope around 05:37 ==="
docker logs --since "2026-08-17T05:35:50Z" --until "2026-08-17T05:38:00Z" nyv-gateway 2>&1 \
  | grep -iE "ORCHESTRATION COMPLETE|QualityEnvelope|mandatory steps|falling back|queenCotApplied|AdaptiveRouter" | tail -20
