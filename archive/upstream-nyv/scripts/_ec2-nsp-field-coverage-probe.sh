#!/usr/bin/env bash
# NSP field coverage probe — runs ON nysdev EC2. NV-SECRETS-001: field names only, no PII values.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then
  echo "NSP_SKIP=no_key_in_canon"
  exit 0
fi

python3 - "$NSPK" "$API" <<'PY'
import json, sys, urllib.request

key, api = sys.argv[1:3]

IDENTITY_FIELDS = [
    "cnr", "diaryNumber", "courtName", "courtType", "caseNo", "caseTitle",
    "caseStatus", "filingNumber", "filingNumberYear", "filingDate",
    "decisionDate", "disposalNature", "citation", "policeStation",
    "firNo", "firYear", "bench", "complexName",
]

def is_nonempty(val):
    if val is None:
        return False
    if isinstance(val, str):
        return bool(val.strip())
    if isinstance(val, list):
        return len(val) > 0
    if isinstance(val, dict):
        return len(val) > 0
    return True

def resolve(body):
    req = urllib.request.Request(
        f"{api}/api/jrx/v1/sdk/cnr/resolve",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "X-API-Key": key,
            "X-NYV-Platform": "nsp",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.status, json.load(resp)

def field_report(label, payload):
    data = payload.get("data") or {}
    fields = data.get("fields") or {}
    meta = data.get("meta") or {}
    counts = meta.get("counts") or {}
    sources = data.get("sourcesTried") or []
    populated = []
    empty = []
    for f in IDENTITY_FIELDS:
        fv = fields.get(f) or {}
        val = fv.get("value")
        if is_nonempty(val):
            populated.append(f)
        else:
            empty.append(f)
    hearings = fields.get("hearings", {}).get("value") or []
    acts = fields.get("actsSections", {}).get("value") or []
    advocates = fields.get("advocates", {}).get("value") or []
    docs = data.get("documents") or []
    cc = data.get("caseCreate") or {}
    clients = cc.get("clients") or []
    party_pii = []
    for c in clients:
        for p in ("address", "phone", "email", "fatherName"):
            if c.get(p):
                party_pii.append(p)
    for c in cc.get("opposingParties") or []:
        for p in ("address", "phone", "email", "fatherName"):
            if c.get(p):
                party_pii.append(p)
    print(f"=== {label} ===")
    print(f"http_status=200 status={data.get('status')} source={data.get('source')} sourcesTried={','.join(sources)}")
    print(f"populated_identity({len(populated)}): {','.join(populated)}")
    print(f"empty_identity({len(empty)}): {','.join(empty)}")
    print(f"hearings_len={len(hearings)} timeline_len={len(cc.get('timeline') or [])} counts_hearings={counts.get('hearings')} counts_acts={counts.get('acts')}")
    print(f"acts_len={len(acts)} advocates_len={len(advocates)} documents_len={len(docs)}")
    print(f"party_pii_nonempty={','.join(sorted(set(party_pii))) or 'none'}")
    hearing_doc_urls = sum(1 for h in hearings if isinstance(h, dict) and h.get("docUrl"))
    print(f"hearing_docUrl_count={hearing_doc_urls}")

probes = [
    ("SC_DIARY_173292025", {"diaryNumber": "173292025", "options": {"courtType": "sc", "profile": "caseCreate", "includeTimeline": True}}),
    ("HC_RJHC010324382023", {"cnr": "RJHC010324382023", "options": {"courtType": "hc", "profile": "caseCreate", "includeTimeline": True}}),
    ("HC_GJHC240256342024", {"cnr": "GJHC240256342024", "options": {"courtType": "hc", "profile": "default", "includeTimeline": True}}),
    ("DC_TSWL000000742024", {"cnr": "TSWL000000742024", "options": {"courtType": "dc", "profile": "default", "includeTimeline": True}}),
]

for label, body in probes:
    try:
        status, payload = resolve(body)
        field_report(label, payload)
    except Exception as e:
        print(f"=== {label} ===")
        print(f"ERROR={type(e).__name__}:{e}")

print("=== PROBE COMPLETE ===")
PY
