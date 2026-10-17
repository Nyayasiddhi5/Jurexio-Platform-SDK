#!/usr/bin/env bash
# NV-SME-PARALLEL-001 — EC2-side SME legal-chat batch.
# Runs US/EU/GLOBAL × free_chat/drafting through the SME path (X-NV-Shell: sme,
# superadmin login) via curl against the public edge (ALB 600s → gateway), so
# the result is independent of the operator's local network. Captures per-scenario
# run_complete time to prove the parallel-mode latency cut (<300s target).
#
# Designed to be launched detached (nohup) writing to /tmp/jrx-sme-parallel-batch.log.
set -uo pipefail
GATEWAY="${GATEWAY:-https://api.nyayasiddhi.online}"
EMAIL="${SME_LOGIN_EMAIL:-legalchat-admin-uat@nyayavigya.in}"
PASSWORD="${SME_LOGIN_PASSWORD:-Demo@2026!}"
MAXT="${MAXT:-420}"
JURS="${JURS:-US EU GLOBAL}"
MODES="${MODES:-free_chat drafting}"

declare -A PROMPTS=(
  [free_chat]="Summarise the elements of a valid contract."
  [drafting]="Draft a one-page mutual NDA between two software firms."
)

echo "=== NV-SME-PARALLEL-001 batch @ $(date -u +%FT%TZ) ==="
echo "gateway=$GATEWAY jurs=[$JURS] modes=[$MODES] max_time=${MAXT}s"

TOKEN="$(curl -sS -X POST "$GATEWAY/api/auth/login" \
  -H 'Content-Type: application/json' -H "Origin: $GATEWAY" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null)"
echo "token_len=${#TOKEN}"
if [ "${#TOKEN}" -lt 10 ]; then echo "FATAL: login failed"; exit 2; fi

PASS=0; TOTAL=0
printf '%-8s %-10s %-6s %-8s %s\n' "JUR" "MODE" "RESULT" "ELAPSED" "ORCH"
for J in $JURS; do
  for MODE in $MODES; do
    TOTAL=$((TOTAL+1))
    PROMPT="${PROMPTS[$MODE]:-Summarise the elements of a valid contract.}"
    SID="$(curl -sS -X POST "$GATEWAY/api/jrx/legal-chat/sessions" \
      -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
      -H "Origin: $GATEWAY" -H 'X-NV-Shell: sme' \
      -d "{\"title\":\"batch $J $MODE\",\"jurisdictions\":[\"$J\"],\"tier\":\"pro\",\"mode\":\"$MODE\"}" \
      | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("session") or {}).get("id") or d.get("id") or "")' 2>/dev/null)"

    RES="$(curl -sS --no-buffer --max-time "$MAXT" -X POST "$GATEWAY/api/jrx/legal-chat/send" \
      -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
      -H "Origin: $GATEWAY" -H 'X-NV-Shell: sme' \
      -d "{\"prompt\":\"$PROMPT\",\"jurisdictions\":[\"$J\"],\"mode\":\"$MODE\",\"sessionId\":\"$SID\"}" \
      2>/dev/null | grep --line-buffered '^data: ' | python3 -u -c '
import sys,time,json
t0=time.time(); orch=""; failed=False; seen=set()
for line in sys.stdin:
    try:
        e=json.loads(line[6:])
        if e.get("orchestrationId"): orch=e["orchestrationId"]
        st=e.get("step")
        if st and st not in seen:
            seen.add(st); sys.stderr.write(f"    step @ {time.time()-t0:6.1f}s {st}\n")
        if st=="run_complete":
            print(f"OK {time.time()-t0:.1f} {orch}"); break
        if st=="run_failed":
            failed=True; print(f"FAILED {time.time()-t0:.1f} {orch}"); break
    except Exception:
        pass
else:
    tag = "FAILED" if failed else "TIMEOUT"
    print(f"{tag} {time.time()-t0:.1f} {orch}")
' 2>>/tmp/jrx-sme-parallel-steps.log)"
    STAT="$(echo "$RES" | awk '{print $1}')"; EL="$(echo "$RES" | awk '{print $2}')"; OR="$(echo "$RES" | awk '{print $3}')"
    if [ "$STAT" = "OK" ]; then PASS=$((PASS+1)); MARK=PASS; else MARK=FAIL; fi
    printf '%-8s %-10s %-6s %-8s %s\n' "$J" "$MODE" "$MARK" "${EL}s" "${OR:--}"
  done
done
echo ""
echo "[batch] $PASS/$TOTAL PASS"
echo "=== done @ $(date -u +%FT%TZ) ==="
