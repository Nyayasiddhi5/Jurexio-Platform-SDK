#!/bin/sh
# NSP follow-up: (a) which analyze operation carries the structured fields, and does
# the path they call still return empty arrays; (b) the "BNS 138 Abduction" grounding
# on a cheque-dishonour matter (NI Act 138) — a precision bug visible to end users.
# Positive control: key >=16 chars, and each call must be http=200.
CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN"; exit 3; fi
B=http://localhost:5000
H="-H Content-Type:application/json -H X-NYV-Platform:nsp -H X-NYV-Consent:granted -H X-Customer-User-Id:nsp:o:3:u:315"

# A cheque-dishonour matter: Section 138 here is the NEGOTIABLE INSTRUMENTS ACT,
# not BNS 138 (abduction). This is the exact confusion NSP reported.
cat > /tmp/cheque.json <<'JSON'
{"jurisdiction":"IN","documentText":"IN THE COURT OF THE XIV ADDITIONAL CHIEF METROPOLITAN MAGISTRATE, HYDERABAD\n\nCrl.M.P. No. 4471 of 2025\n\nComplaint under Section 138 of the Negotiable Instruments Act, 1881\n\nBETWEEN:\nMeridian Textiles Pvt Ltd, rep. by its Managing Director\n... COMPLAINANT\n\nAND\n\nRam Kumar S/o Late Shri Mohan Lal\n... ACCUSED\n\n1. That the accused issued cheque no. 004512 dated 10 January 2025 for Rs 8,40,000 drawn on State Bank of India, Banjara Hills branch.\n2. That the said cheque was returned unpaid with the endorsement 'funds insufficient' on 20 January 2025.\n3. That statutory notice under Section 138(b) was issued on 05 February 2025 and the accused failed to pay within 15 days.\n4. That FIR No. 221 of 2025 was registered at Banjara Hills Police Station.\n5. That the matter is listed on 20 September 2025.\n\nPRAYER:\nIt is prayed that the accused be punished under Section 138 of the Negotiable Instruments Act, 1881.","content":"IN THE COURT OF THE XIV ADDITIONAL CHIEF METROPOLITAN MAGISTRATE, HYDERABAD\n\nCrl.M.P. No. 4471 of 2025\n\nComplaint under Section 138 of the Negotiable Instruments Act, 1881\n\nBETWEEN:\nMeridian Textiles Pvt Ltd, rep. by its Managing Director\n... COMPLAINANT\n\nAND\n\nRam Kumar S/o Late Shri Mohan Lal\n... ACCUSED\n\n1. That the accused issued cheque no. 004512 dated 10 January 2025 for Rs 8,40,000 drawn on State Bank of India, Banjara Hills branch.\n2. That the said cheque was returned unpaid with the endorsement 'funds insufficient' on 20 January 2025.\n3. That statutory notice under Section 138(b) was issued on 05 February 2025 and the accused failed to pay within 15 days.\n4. That FIR No. 221 of 2025 was registered at Banjara Hills Police Station.\n5. That the matter is listed on 20 September 2025.\n\nPRAYER:\nIt is prayed that the accused be punished under Section 138 of the Negotiable Instruments Act, 1881."}
JSON

for P in /api/jrx/sdk/docs-pipeline/documents/analyze /api/jrx/gateway/documents/analyze; do
  echo "================================================================"
  echo "PATH $P"
  curl -sS -m 200 -o /tmp/r.json -w "  http=%{http_code} t=%{time_total}s bytes=%{size_download}\n" -X POST \
    -H "X-API-Key: $K" $H -d @/tmp/cheque.json "$B$P"
  python3 - <<'PY'
import json
d = json.load(open('/tmp/r.json'))
data = d.get('data') or {}
print('  keys:', sorted(data.keys()))
print('  fieldSource=%s fieldCount=%s detectedType=%s' % (
    data.get('fieldSource'), data.get('fieldCount'), data.get('detectedDocumentType')))
# The arrays NSP maps from:
for k in ('entities','statutes','deadlines','obligations','risks'):
    v = data.get(k)
    if v is None: continue
    n = len(v) if isinstance(v,(list,dict)) else '?'
    print('  NSP-mapped array %-12s present, len=%s' % (k, n))
ents = data.get('entities')
if isinstance(ents, dict):
    print('  entities is an OBJECT with keys:', sorted(ents.keys()),
          '-> lens', {k:(len(v) if isinstance(v,list) else '?') for k,v in ents.items()})
f = data.get('fields') or []
print('  --- fields[] (%d) ---' % len(f))
for x in f[:20]:
    print('    %-20s %-12s %s' % (x.get('key'), x.get('source'), str(x.get('value'))[:60]))
# The mis-grounding NSP reported:
blob = json.dumps(data)
print('  --- statute grounding check ---')
print('  mentions "Negotiable Instruments":', 'Negotiable Instrument' in blob)
print('  mentions "Abduction"             :', 'Abduction' in blob or 'abduction' in blob)
print('  mentions "BNS Section 138"       :', 'BNS Section 138' in blob or 'BNS 138' in blob)
s = str(data.get('summary') or data.get('analysis') or '')
print('  --- first 320 chars of summary/analysis ---')
print(' ', s[:320].replace('\n',' | '))
PY
done
