#!/usr/bin/env bash
# Re-run counsel-grade subset on nysdev (exact harness bodies, readBody-compatible parse).
set -euo pipefail
ENV_FILE="${NYV_ENV_FILE:-/opt/Nyayavigya/secrets/.env.production}"
NSPK="$(grep -E '^NYV_SDK_KEY_NSP=' "$ENV_FILE" | cut -d= -f2-)"
API='http://127.0.0.1:5000'
HDR=(-H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json")

read_body() {
  python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
root=d if isinstance(d,dict) else {}
inner=(root.get('data') or root.get('result') or {}) if isinstance(root,dict) else {}
for k in ('content','response','answer','text','draft'):
  v=(root.get(k) if isinstance(root,dict) else None) or (inner.get(k) if isinstance(inner,dict) else None)
  if isinstance(v,str) and v.strip():
    print(len(v)); print(v[:500].replace(chr(10),' ')); sys.exit(0)
cur=(root.get('curated') or inner.get('curated') or {}) if isinstance(inner,dict) else {}
if isinstance(cur,dict) and isinstance(cur.get('summary'),str) and cur['summary'].strip():
  print(len(cur['summary'])); print(cur['summary'][:500]); sys.exit(0)
print(0); print('')
" "$1"
}

run_case() {
  local name="$1" bodyfile="$2"
  echo "=== $name ==="
  curl -sS -m 180 -o "/tmp/cg-${name}.json" -w 'http=%{http_code} time=%{time_total}\n' \
    -X POST "${HDR[@]}" -d @"$bodyfile" "$API/api/jrx/orchestrate"
  read_body "/tmp/cg-${name}.json"
}

python3 <<'PY' > /tmp/cg-msa.json
import json
print(json.dumps({"taskType":"analysis","jurisdiction":"IN","tier":"pro","prompt":"Analyse the risk allocation in this clause set and identify every obligation, risk and deadline.\n\nCLAUSE 11.2 (INDEMNITY): The Supplier shall indemnify, defend and hold harmless the Customer against all claims, losses and damages arising out of or in connection with the Services, without limitation.\n\nCLAUSE 12.1 (LIABILITY CAP): Notwithstanding anything to the contrary, the aggregate liability of either party shall not exceed the fees paid in the twelve months preceding the claim.\n\nCLAUSE 14.1 (TERMINATION): The Customer may terminate this Agreement for convenience upon thirty (30) days written notice.\n\nCLAUSE 18 (GOVERNING LAW): This Agreement is governed by the laws of India and the courts at Bengaluru shall have exclusive jurisdiction.\n\nCLAUSE 6.3 (RENEWAL): This Agreement renews automatically unless either party gives notice ninety (90) days before the end of the initial term."}))
PY

python3 <<'PY' > /tmp/cg-138.json
import json
print(json.dumps({"taskType":"legal_research","jurisdiction":"IN","tier":"pro","prompt":"What are the leading Supreme Court authorities on the presumption under Section 139 of the Negotiable Instruments Act, and how has the burden of rebuttal been described? Cite the cases."}))
PY

run_case analysis-msa-risk /tmp/cg-msa.json
run_case research-section-138-ni-act /tmp/cg-138.json
