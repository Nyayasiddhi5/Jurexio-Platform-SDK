#!/usr/bin/env bash
# NYV-6 BEFORE probe — every analyze path, plus "which path does NSP actually call".
# Positive control: PC=5150 + /api/jrx/health 200 + key_len=64.
set -uo pipefail
OUT=/tmp/nyv6-before.txt
: > "$OUT"
echo "PC=5150" | tee -a "$OUT"
KEY=$(docker exec nyv-gateway sh -lc 'printf %s "$NYV_SDK_KEY_NSP"')
echo "key_len=${#KEY}" | tee -a "$OUT"
[ "${#KEY}" -eq 64 ] || { echo PROBE_BROKEN_KEY | tee -a "$OUT"; exit 1; }
GW=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' nyv-gateway)
BASE="http://${GW}:5000"
H=(-H "x-api-key: $KEY" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted" -H "content-type: application/json")
hc=$(curl -sS -o /dev/null -w '%{http_code}' -m 15 "${H[@]}" "$BASE/api/jrx/health"); echo "PC_health=$hc" | tee -a "$OUT"
[ "$hc" = "200" ] || { echo PROBE_BROKEN_HEALTH | tee -a "$OUT"; exit 1; }

# A real Indian court filing — must produce non-zero court fields.
DOC=$(cat <<'EOF'
IN THE HIGH COURT OF JUDICATURE AT HYDERABAD
Criminal Petition No. 4471 of 2025
Ram Kumar Reddy, S/o Late Venkat Reddy, aged 42 years ..... PETITIONER
AND
The State of Telangana, rep. by Public Prosecutor ..... RESPONDENT
The petitioner seeks anticipatory bail under Section 438 of the Code of Criminal Procedure, 1973
in connection with FIR No. 233 of 2025 registered at Banjara Hills Police Station for offences
punishable under Sections 420 and 406 of the Indian Penal Code, 1860 and Section 66D of the
Information Technology Act, 2000. The matter is listed before the Hon'ble Justice A. Rajashekar
Reddy on 28 March 2025. The petitioner undertakes to deposit Rs. 5,00,000 within 30 days.
PRAYER: It is prayed that this Hon'ble Court may be pleased to grant anticipatory bail to the
petitioner pending disposal of the investigation.
EOF
)
# Trivial non-document text — must NOT be treated as a filing (the negative control
# that proves a status field is not hardcoded to one value).
TRIVIAL="Hello there. Please tell me the weather in Hyderabad today and nothing else at all."

jqf() { python3 -c '
import json,sys
raw=sys.stdin.read()
try: d=json.loads(raw)
except Exception as e:
    print("NON_JSON:",raw[:300]); raise SystemExit
d=d.get("data",d) if isinstance(d,dict) else d
if not isinstance(d,dict): print("NOT_OBJ:",str(d)[:200]); raise SystemExit
keys=["analysisStatus","analysisStatusReason","status","fieldSource","fieldCount","degraded","degradeReason","source","isIndianCourtDocument","detectedDocumentType"]
for k in keys:
    if k in d: print(f"  {k} = {json.dumps(d[k])[:220]}")
for k in ["entities","statutes","deadlines","risks","obligations","entitiesFlat","deadlinesFlat","risksFlat","obligationsFlat","fields"]:
    if k in d:
        v=d[k]
        if isinstance(v,list): print(f"  {k}: ARRAY len={len(v)}")
        elif isinstance(v,dict): print(f"  {k}: CONTAINER keys={list(v.keys())} lens={ {kk:(len(vv) if isinstance(vv,list) else type(vv).__name__) for kk,vv in v.items()} }")
        else: print(f"  {k}: {type(v).__name__}")
print("  ALL_TOP_KEYS =", sorted(d.keys()))
'; }

probe() { # label path json tmo
  local label="$1" path="$2" body="$3" tmo="${4:-120}"
  local f; f=$(mktemp)
  local code tt
  read -r code tt < <(curl -sS -o "$f" -w '%{http_code} %{time_total}' -m "$tmo" -X POST "${H[@]}" -d "$body" "$BASE$path" 2>/dev/null || echo "000 0")
  { echo; echo "=== $label"; echo "http=$code time=${tt}s POST $path"; } >> "$OUT"
  case "$code" in 2*) jqf < "$f" >> "$OUT" ;; *) { echo "  raw_error: $(head -c 400 "$f")"; } >> "$OUT" ;; esac
  rm -f "$f"
}

DOC_J=$(python3 -c 'import json,os;print(json.dumps(os.environ["D"]))' D="$DOC")
TRIV_J=$(python3 -c 'import json,os;print(json.dumps(os.environ["D"]))' D="$TRIVIAL")
echo "doc_len=${#DOC} doc_json_len=${#DOC_J}" | tee -a "$OUT"
# Instrument guard: the filing is ~800 chars. A short/empty payload would make every
# analyze path answer 400 DOCUMENT_TEXT_REQUIRED and look like a platform defect.
[ "${#DOC}" -gt 500 ] || { echo "PROBE_BROKEN: doc_len too small" | tee -a "$OUT"; exit 1; }

# PATH 1 — gateway
probe "P1-gateway-COURTDOC" /api/jrx/gateway/documents/analyze "{\"content\":$DOC_J,\"type\":\"court_filing\",\"jurisdiction\":\"IN\"}" 150
# PATH 2 — docs-pipeline alias (and /intelligence, same handler)
probe "P2-docspipeline-analyze-COURTDOC" /api/jrx/sdk/docs-pipeline/documents/analyze "{\"documentText\":$DOC_J,\"jurisdiction\":\"IN\"}" 150
probe "P2b-docspipeline-intelligence-COURTDOC" /api/jrx/sdk/docs-pipeline/documents/intelligence "{\"documentText\":$DOC_J,\"jurisdiction\":\"IN\"}" 150
# PATH 3 — orchestrate (the path NSP reportedly calls)
probe "P3-orchestrate-COURTDOC" /api/jrx/orchestrate "{\"prompt\":\"Analyse this court document and extract the structured fields.\",\"content\":$DOC_J,\"taskType\":\"analysis\",\"jurisdiction\":\"IN\"}" 200
# NEGATIVE CONTROLS — trivial text must NOT report structured success
probe "N1-gateway-TRIVIAL" /api/jrx/gateway/documents/analyze "{\"content\":$TRIV_J,\"type\":\"legal\",\"jurisdiction\":\"IN\"}" 150
probe "N2-docspipeline-TRIVIAL" /api/jrx/sdk/docs-pipeline/documents/analyze "{\"documentText\":$TRIV_J,\"jurisdiction\":\"IN\"}" 150

# PATH 4 — EDJ worker (async). Submit + poll.
{ echo; echo "=== P4-EDJ (ecosystem document job) discovery"; } >> "$OUT"
for p in /api/jrx/ecosystem/documents/jobs /api/jrx/documents/jobs /api/jrx/ecosystem-documents/jobs; do
  c=$(curl -sS -o /tmp/edj.$$ -w '%{http_code}' -m 20 "${H[@]}" "$BASE$p" 2>/dev/null || echo 000)
  { echo "  GET $p -> http=$c $(head -c 200 /tmp/edj.$$)"; } >> "$OUT"; rm -f /tmp/edj.$$
done

# Which path does NSP actually call? Ask the access log / sdk usage table.
{ echo; echo "=== NSP CALL EVIDENCE — gateway logs (analyze paths, last 2h)"; } >> "$OUT"
docker logs nyv-gateway --since 6h 2>&1 | grep -oE '(POST|GET) /api/nv[a-zA-Z0-9/_.-]*(analyze|intelligence|orchestrate)[a-zA-Z0-9/_.-]*' | sort | uniq -c | sort -rn | head -30 >> "$OUT" 2>&1
{ echo "  (log grep exit handled; empty means no matching lines in 6h window)"; } >> "$OUT"

echo "DONE=5150" >> "$OUT"
wc -c "$OUT"
cat "$OUT"
