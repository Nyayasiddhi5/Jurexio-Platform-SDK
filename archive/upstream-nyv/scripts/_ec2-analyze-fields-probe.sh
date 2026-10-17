#!/bin/sh
# What does analyzeDocument actually return for an Indian court document?
# NSP badges "Heuristic" because they cannot find fields — confirm that from the
# body rather than assuming. Positive control: key >=16 chars and http=200.
CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN: no NSP key"; exit 3; fi

cat > /tmp/doc.json <<'JSON'
{"jurisdiction":"IN","type":"petition","content":"IN THE HIGH COURT OF JUDICATURE AT HYDERABAD\nFOR THE STATE OF TELANGANA\n\nCriminal Petition No. 4471 of 2025\n\nBETWEEN:\nRam Kumar S/o Late Shri Mohan Lal, aged 42 years, R/o 12-3-45 Banjara Hills, Hyderabad\n... PETITIONER\n\nAND\n\nThe State of Telangana, rep. by its Public Prosecutor, High Court of Telangana\n... RESPONDENT No. 1\nMeridian Textiles Pvt Ltd, rep. by its Managing Director\n... RESPONDENT No. 2\n\nPETITION UNDER SECTION 482 OF THE BHARATIYA NAGARIK SURAKSHA SANHITA, 2023 FOR GRANT OF ANTICIPATORY BAIL\n\nThe Petitioner respectfully submits:\n1. That FIR No. 221 of 2025 was registered at Banjara Hills Police Station on 12 March 2025 under Sections 318 and 316(2) of the Bharatiya Nyaya Sanhita, 2023.\n2. That the alleged amount involved is Rs 47,00,000 (Rupees Forty Seven Lakhs only).\n3. That the Petitioner has cooperated with the investigation and is not a flight risk.\n4. That the matter is listed before the Hon'ble Justice A. Rajashekar Reddy on 28 March 2025.\n\nPRAYER:\nIt is therefore prayed that this Hon'ble Court may be pleased to grant anticipatory bail to the Petitioner.\n\nHyderabad\nDate: 20 March 2025\nCounsel for the Petitioner"}
JSON

echo "=== POST /api/jrx/gateway/documents/analyze ==="
curl -sS -m 180 -o /tmp/an.json -w "http=%{http_code} t=%{time_total}s bytes=%{size_download}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: probe-user-1" -H "Content-Type: application/json" \
  -d @/tmp/doc.json \
  https://api.nyayasiddhi.online/api/jrx/gateway/documents/analyze

python3 - <<'PY'
import json
d = json.load(open('/tmp/an.json'))
data = d.get('data') or {}
print('success        :', d.get('success'))
print('top-level keys :', sorted(data.keys()))
print('')
print('STRUCTURED FIELDS PRESENT?')
for k in ('fields','entities','caseNumber','court','parties','statutes','documentType','extraction'):
    print('  %-14s %s' % (k, 'YES' if k in data else 'no'))
a = str(data.get('analysis') or '')
print('')
print('analysis is a prose blob: %s (len=%d)' % (not a.strip().startswith('{'), len(a)))
print('--- analysis first 500 ---')
print(a[:500])
PY

echo "=== extracted field values (correctness, not presence) ==="
python3 - <<'PY'
import json
d = json.load(open('/tmp/an.json')).get('data') or {}
print('fieldSource=%s fieldCount=%s detectedType=%s isCourtDoc=%s'
      % (d.get('fieldSource'), d.get('fieldCount'), d.get('detectedDocumentType'), d.get('isIndianCourtDocument')))
for f in d.get('fields') or []:
    print('  %-20s %-12s %.2f  %s' % (f.get('key'), f.get('source'), f.get('confidence', 0), str(f.get('value'))[:80]))
PY
