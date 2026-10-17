#!/usr/bin/env bash
# Post-deploy live verification — run on EC2 via SSM (no secrets printed).
set -uo pipefail

LIVE="$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1 || true)"
echo "LIVE=${LIVE:-missing}"
echo "CURRENT=$(cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"
echo "LAST_GOOD=$(cat /opt/nyayavigya/LAST_GOOD_DEPLOY 2>/dev/null || echo missing)"
echo "GW5000=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health || echo 000)"
echo "ING80=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/jrx/health || echo 000)"

if [ -n "${LIVE:-}" ] && [ -f "$LIVE/scripts/jrx-verify-ingress.sh" ]; then
  set +e
  bash "$LIVE/scripts/jrx-verify-ingress.sh" 2>&1 | tail -15
  echo "INGRESS_RC=$?"
  set -e
fi

docker inspect nyv-gateway --format 'gateway_status={{.State.Status}} stop_timeout={{.HostConfig.StopTimeout}}' 2>/dev/null || echo gateway_inspect=fail
grep -E 'stop_grace_period' "$LIVE/docker-compose.aws-dev.yml" 2>/dev/null | head -1 || echo stop_grace_period=absent
docker exec nyv-gateway printenv NYV_BUILD_ID 2>/dev/null || echo NYV_BUILD_ID=unset

# Feature probes — use partner key from canonical env without printing it
ENV_FILE="/opt/Nyayavigya/secrets/.env.production"
KEY="$(grep -E '^NYV_SDK_KEY_NSP=' "$ENV_FILE" 2>/dev/null | head -1 | sed -E 's/^NYV_SDK_KEY_NSP=//; s/^"//; s/"$//')"
if [ -n "$KEY" ]; then
  HDR=(-H "X-API-Key: $KEY" -H 'X-NYV-Platform: nsp' -H 'X-NYV-Consent: granted')
  echo "courtType_probe=$(curl -s "${HDR[@]}" "http://127.0.0.1:5000/api/jrx/knowledge/caselaw/search?q=bail&courtType=sc&limit=1" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('data',{}); print('ok' if d.get('success') and r.get('results') and 'Supreme Court' in str(r.get('results',[{}])[0].get('court','')) else 'fail')" 2>/dev/null || echo fail)"
  echo "citator_probe=$(curl -s "${HDR[@]}" "http://127.0.0.1:5000/api/jrx/knowledge/caselaw/treatment?citation=%5B1980%5D%203%20S.C.R.%20383&exact=true" | python3 -c "import sys,json; d=json.load(sys.stdin); a=d.get('data',{}).get('authority',{}); print('unresolved' if a.get('matched') is False else 'BAD')" 2>/dev/null || echo fail)"
  BODY='{"prompt":"IN THE HIGH COURT OF TELANGANA. Anticipatory bail under Section 438 CrPC.","taskType":"legal-chat-fast","jurisdiction":"IN"}'
  echo "analysisStatus_probe=$(curl -s "${HDR[@]}" -H 'Content-Type: application/json' -d "$BODY" "http://127.0.0.1:5000/api/jrx/orchestrate" | python3 -c "import sys,json; d=json.load(sys.stdin); e=(d.get('data') or {}).get('extras') or {}; print(e.get('analysisStatus','ABSENT'))" 2>/dev/null || echo fail)"
else
  echo "feature_probes=SKIP(no_key)"
fi
