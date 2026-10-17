#!/bin/sh
# Reproduce EXACTLY what NSP sees: document analysis via ORCHESTRATE (not the REST handlers
# I already fixed). NSP reports entities:[] statutes:[] deadlines:[] and no fieldSource.
# Goal: identify which code path serves it, so the fix lands on the path they actually call.
set -u
CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
[ `printf %s "$K" | wc -c` -lt 16 ] && { echo "PROBE BROKEN: no key"; exit 3; }

DOC='IN THE HIGH COURT OF JUDICATURE AT HYDERABAD
Criminal Petition No. 4471 of 2025
Between: Sri Ramesh Kumar Reddy, S/o Late Venkat Reddy, aged 42 years, R/o Plot 14, Jubilee Hills, Hyderabad ... Petitioner
AND
The State of Telangana, rep. by its Public Prosecutor, High Court of Telangana ... Respondent
Crime No. 221 of 2025 of Banjara Hills Police Station, registered under Sections 420 and 406 of the Bharatiya Nyaya Sanhita, 2023.
The cheque bearing No. 445512 dated 14 January 2025 for Rs. 12,50,000/- was dishonoured with the endorsement "funds insufficient" on 22 January 2025.
Statutory notice under Section 138 of the Negotiable Instruments Act, 1881 was issued on 5 February 2025.
The matter is posted before the Honourable Justice A. Rajashekar Reddy for hearing on 28 March 2025.
PRAYER: The petitioner prays that this Honourable Court may be pleased to grant anticipatory bail.'

probe () {
  LABEL="$1"; BODY="$2"
  echo ""
  echo "=== $LABEL ==="
  curl -sS -m 180 -o /tmp/o.json -w "  http=%{http_code} t=%{time_total}s\n" -X POST \
    -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
    -H "X-Customer-User-Id: nsp:o:3:u:315" -H "Content-Type: application/json" \
    -d "$BODY" https://api.nyayasiddhi.online/api/jrx/orchestrate
  python3 - <<'PY'
import json
try: d = json.load(open('/tmp/o.json'))
except Exception as e: print('  UNPARSEABLE:', e); raise SystemExit
x = d.get('data') or d
def find(o, key, path='', hits=None):
    if hits is None: hits = []
    if isinstance(o, dict):
        for k, v in o.items():
            if k == key: hits.append((path + '.' + k, v))
            find(v, key, path + '.' + k, hits)
    elif isinstance(o, list):
        for i, v in enumerate(o[:3]): find(v, key, f'{path}[{i}]', hits)
    return hits
print('  top-level keys :', sorted(x.keys())[:14])
for key in ('fieldSource','fields','fieldCount','entities','statutes','deadlines','obligations','detectedDocumentType'):
    h = find(x, key)
    if not h: print(f'  {key:20} ABSENT')
    else:
        for p, v in h[:2]:
            s = v if not isinstance(v,(list,dict)) else (f'list[{len(v)}]' if isinstance(v,list) else f'dict{sorted(v.keys())[:5]}')
            print(f'  {key:20} at {p} = {str(s)[:90]}')
c = x.get('content') or ''
print(f'  content        : {len(str(c))} chars; starts: {str(c)[:100]!r}')
print(f'  routing/model  : {(x.get("cost") or {}).get("model")} | resolution={(x.get("cost") or {}).get("resolution")}')
print(f'  agentsUsed     : {x.get("agentsUsed") or (x.get("meta") or {}).get("agentsUsed")}')
PY
}

# The two shapes NSP plausibly uses for "document-analyzer via orchestrate".
probe "A. taskType=analysis + document content" \
  "$(python3 -c "import json,os;print(json.dumps({'prompt':'Analyse this court document and extract all structured fields.','taskType':'analysis','jurisdiction':'IN','content':os.environ['DOC'],'documentContent':os.environ['DOC']}))" DOC="$DOC")"

probe "B. taskType=document-analysis" \
  "$(python3 -c "import json,os;print(json.dumps({'prompt':'Analyse this court document.','taskType':'document-analysis','jurisdiction':'IN','content':os.environ['DOC']}))" DOC="$DOC")"

echo ""
echo "=== C. for contrast: the REST handler I DID fix (must show fieldSource=nyv) ==="
curl -sS -m 120 -o /tmp/r.json -w "  http=%{http_code} t=%{time_total}s\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" -H "Content-Type: application/json" \
  -d "$(python3 -c "import json,os;print(json.dumps({'content':os.environ['DOC'],'documentType':'petition','jurisdiction':'IN'}))" DOC="$DOC")" \
  https://api.nyayasiddhi.online/api/jrx/sdk/docs-pipeline/documents/analyze
python3 -c "
import json;d=json.load(open('/tmp/r.json'));x=d.get('data') or d
print('  fieldSource=%s fieldCount=%s statutes=%s'%(x.get('fieldSource'),x.get('fieldCount'),len(x.get('statutes') or [])))"
